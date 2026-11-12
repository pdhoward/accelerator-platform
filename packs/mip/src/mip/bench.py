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


def score(m: dict, x: dict) -> dict:
    subset = {p["id"] for p in x["subset"]}
    got, want = index_map(m), index_expected(x)
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
    # What MIP must not claim (mip.md §8): the asynchronous RUN's programs stay unresolved.
    run_claims = [e for p in m["parts"] for e in p["edges"] if e.get("asynchronous") and e.get("dynamic") and e["dynamic"].get("resolved")]
    report["_unresolved_respected"] = {"run_transid_programs_asserted": len(run_claims)}
    return report


def main(argv: list[str]) -> int:
    m, x = load(argv[0]), load(argv[1])
    r = score(m, x)
    print(f"{'category':18s} {'expected':>8s} {'found':>6s} {'matched':>7s} {'recall':>7s} {'precision':>9s}")
    for cat, v in r.items():
        if cat.startswith("_"):
            continue
        print(f"{cat:18s} {v['expected']:8d} {v['found']:6d} {v['matched']:7d} {v['recall']:7.1%} {v['precision']:9.1%}")
    print("unresolved respected:", r["_unresolved_respected"])
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
