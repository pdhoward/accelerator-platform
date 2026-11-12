"""
Score MIP against a golden expected-results manifest (mip.md §8, P1 exit criterion).

    python -m mip.bench <map.json> <expected.json>

Every expected item is matched by (program, kind, target, line); a miss or an extra is
listed with its citation, so each disagreement can be settled by reading the source.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path


def load(p: str) -> dict:
    return json.loads(Path(p).read_text(encoding="utf-8"))


def index_map(m: dict) -> dict[str, set]:
    got: dict[str, set] = defaultdict(set)
    for part in m["parts"]:
        for e in part["edges"]:
            line, frm, kind = e["cite"]["line"], e["from"], e["kind"]
            if kind == "links" or kind == "transfers":
                to = e["to"]
                got["link" if kind == "links" else "xctl"].add((frm, to.strip(), line))
            elif kind == "starts":
                if e.get("asynchronous"):
                    got["run_async"].add((frm, line))
                elif e.get("command", "").startswith("RETURN"):
                    got["return_transid"].add((frm, e["to"].replace("TX:", ""), line))
            elif kind == "calls" and not e.get("dynamic"):
                got["call"].add((frm, e["to"], line))
            elif kind in ("reads", "writes", "updates", "deletes") and e["to"].startswith("file:") and e.get("command"):
                got[f"cics_file_{e['command'].lower()}"].add((frm, e["to"][5:], line))
            elif kind == "includes" and not e.get("sql_include"):
                got["copy"].add((frm, e["to"][4:], line, bool(e.get("replacing"))))
            elif kind == "runs" and e.get("via"):
                got["batch"].add((e["cite"]["file"], e["to"], line))
        for s in part.get("statements", []):
            if s["verb"] in ("SELECT", "INSERT", "UPDATE", "DELETE", "DECLARE", "FETCH"):
                got["sql"].add((s["program"], s["verb"], tuple(sorted(s.get("tables", []))), s["line"]))
    return got


def index_expected(x: dict) -> dict[str, set]:
    want: dict[str, set] = defaultdict(set)
    for e in x["expected"]["edges"]:
        k = e["kind"]
        if k in ("link", "xctl"):
            if e.get("to"):
                want[k].add((e["from"], e["to"], e["line"]))
        elif k == "return_transid":
            want[k].add((e["from"], e["to_transid"], e["line"]))
        elif k == "run_async":
            want[k].add((e["from"], e["line"]))
        elif k == "call":
            want[k].add((e["from"], e["to"], e["line"]))
        elif k.startswith("cics_file_"):
            want[k].add((e["from"], e["to_file"], e["line"]))
    for s in x["expected"]["sql"]:
        want["sql"].add((s["program"], s["verb"], tuple(sorted(s["tables"])), s["line"]))
    for c in x["expected"]["copybooks"]:
        want["copy"].add((c["program"], c["copybook"], c["line"], bool(c.get("replacing"))))
    for b in x["expected"]["batch"]:
        want["batch"].add((b["job_file"], b["program"], b["line"]))
    return want


def score_p2(m: dict, x: dict) -> dict:
    """P2: resolved values, interface findings with their severity, and what must not be a finding."""
    p2 = x.get("p2") or {}
    edges = [e for p in m["parts"] for e in p["edges"]]
    findings = {(f["caller"], f["callee"], f["line"]): f for f in m.get("findings", [])}
    interfaces = {(i["caller"], i["callee"], i["line"]): i for p in m["parts"] for i in p.get("interfaces", [])}
    out = {"resolved": [], "interfaces": [], "not_findings": []}
    for r in p2.get("resolved", []):
        kind = {"run_async": lambda e: e.get("asynchronous"), "xctl": lambda e: e["kind"] == "transfers", "link": lambda e: e["kind"] == "links"}[r["kind"]]
        e = next((e for e in edges if e["from"] == r["program"] and e["cite"]["line"] == r["line"] and kind(e)), None)
        got = (e.get("dynamic") or {}).get("resolved", []) if e else None
        out["resolved"].append({"program": r["program"], "line": r["line"], "ok": got == r["values"], "expected": r["values"], "got": got})
    for want in p2.get("interfaces", []):
        f = findings.get((want["caller"], want["callee"], want["line"]))
        ok = bool(f) and f.get("verdict") == want["verdict"] and f.get("severity") == want["severity"] and f.get("caller_size") == want["caller_size"] and f.get("callee_size") == want["callee_size"]
        out["interfaces"].append({**{k: want[k] for k in ("caller", "callee", "line", "severity")}, "ok": ok, "got": {k: f.get(k) for k in ("verdict", "severity", "caller_size", "callee_size")} if f else None})
    for nf in p2.get("not_findings", []):
        i = interfaces.get((nf["caller"], nf["callee"], nf["line"]))
        out["not_findings"].append({"caller": nf["caller"], "callee": nf["callee"], "ok": (nf["caller"], nf["callee"], nf["line"]) not in findings and bool(i) and i["verdict"] == nf["verdict"], "got": i["verdict"] if i else None})
    expected = {(w["caller"], w["callee"], w["line"]) for w in p2.get("interfaces", [])}
    out["unexpected_findings"] = [{"caller": k[0], "callee": k[1], "line": k[2], "severity": v.get("severity")} for k, v in findings.items() if k not in expected]
    programs = {u["id"] for p in m["parts"] for u in p["units"] if u["kind"] == "program"}
    out["async_programs_asserted"] = [e["cite"] for e in edges if e.get("asynchronous") and any(v in programs for v in (e.get("dynamic") or {}).get("resolved", []))]
    return out


def score(m: dict, x: dict) -> dict:
    subset = {p["id"] for p in x.get("subset", [])}
    got, want = index_map(m), index_expected(x) if "expected" in x else {}
    report = {}
    for cat in sorted(want):
        w = want[cat]
        # Programs outside the subset, and job files the manifest doesn't cover, are out of scope (not errors).
        files = {t[0] for t in w} if cat == "batch" else None
        g = {t for t in got.get(cat, set()) if (t[0] in files if cat == "batch" else t[0] in subset)}
        hit = g & w
        report[cat] = {
            "expected": len(w),
            "found": len(g),
            "matched": len(hit),
            "recall": round(len(hit) / len(w), 4) if w else 1.0,
            "precision": round(len(hit) / len(g), 4) if g else (1.0 if not w else 0.0),
            "missed": sorted(w - g)[:20],
            "extra": sorted(g - w)[:20],
        }
    report["_p2"] = score_p2(m, x)
    return report


def main(argv: list[str]) -> int:
    m, x = load(argv[0]), load(argv[1])
    r = score(m, x)
    print(f"{'category':18s} {'expected':>8s} {'found':>6s} {'matched':>7s} {'recall':>7s} {'precision':>9s}")
    for cat, v in r.items():
        if cat.startswith("_"):
            continue
        print(f"{cat:18s} {v['expected']:8d} {v['found']:6d} {v['matched']:7d} {v['recall']:7.1%} {v['precision']:9.1%}")
    p2 = r["_p2"]
    print("\nP2")
    for row in p2["resolved"]:
        print(f"  resolved {row['program']}:{row['line']:<5} {'ok ' if row['ok'] else 'MISS'} {row['got']}")
    for row in p2["interfaces"]:
        print(f"  finding  {row['caller']} -> {row['callee']}:{row['line']} ({row['severity']}) {'ok ' if row['ok'] else 'MISS'} {row['got']}")
    for row in p2["not_findings"]:
        print(f"  not a finding {row['caller']} -> {row['callee']} {'ok ' if row['ok'] else 'WRONG'} ({row['got']})")
    print(f"  unexpected findings: {p2['unexpected_findings'] or 'none'}")
    print(f"  asynchronous RUN naming a program: {p2['async_programs_asserted'] or 'none'}")
    for cat, v in r.items():
        if cat.startswith("_"):
            continue
        if v["missed"] or v["extra"]:
            print(f"\n{cat}: missed {v['missed'][:8]}\n{' ' * len(cat)}  extra  {v['extra'][:8]}")
    if len(argv) > 2:
        Path(argv[2]).write_text(json.dumps(r, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
