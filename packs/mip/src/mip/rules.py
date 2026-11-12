"""
Candidate business rules (P4, deterministic half). A rule candidate is a block that sets an output
the calling program receives (a fail code, a success flag, a score, a routing target) under at least
one business condition: purely technical guards (SQLCODE, CICS response codes, EIBCALEN) don't make
a rule. Each candidate carries its trace (applies when, decided by, reached from, where the outcome
goes), its review items, and the source lines as evidence: the packet the crew's model reads to name
the rule in business words and propose answers (mip.md M8). Nothing here calls a model.

    python -m mip.rules <repo> [--programs A,B] --out candidates.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .interfaces import callee_view
from .source import read_text
from .trace import Model, Tracer, business

def outputs(m: Model, name: str) -> set[str]:
    """What the calling program receives: the fields of the COMMAREA this program reads."""
    prog = m.programs[name]
    view = callee_view(prog, m.index.view(prog.path))
    return {f["name"] for f in (view or {}).get("fields", [])}


def candidates(m: Model, names: list[str] | None = None) -> list[dict]:
    out = []
    for name in names or sorted(m.programs):
        if name not in m.programs:
            continue
        outs = outputs(m, name)
        if not outs:
            continue
        flow = m.flow(name)
        groups: dict[tuple, list] = {}
        for s in flow.statements():
            sets = [st for st in s.sets if st["field"] in outs]
            if not sets or not any(business(g.text, g.kind) for g in s.guards):
                continue
            # One decision, one candidate: the THEN and ELSE of the same IF (same guard lines) go together.
            key = (s.para, tuple(g.line for g in s.guards))
            groups.setdefault(key, []).append((s, sets))
        for (para, _), members in groups.items():
            out.append(packet(m, name, members))
    return out


def packet(m: Model, name: str, members) -> dict:
    prog = m.programs[name]
    tr = Tracer(m)
    reps: dict[tuple, object] = {}
    for s, _ in sorted(members, key=lambda x: x[0].line):
        reps.setdefault(tuple(g.render() for g in s.guards), s)
    traces = [tr.trace(name, s.line, depth=5) for s in reps.values()]
    first, t = next(iter(reps.values())), traces[0]
    decided = {}
    for tt in traces:
        for f, nodes in tt["decided_by"].items():
            decided.setdefault(f, nodes)
    outcome, branches = [], []
    for s, sets in members:
        for st in sets:
            o = {"field": st["field"], "line": st["line"]}
            if st.get("literal") is not None:
                o["value"] = st["literal"]
            else:
                o["from"] = st["from"]
                # The value an outcome takes is part of the rule (a score is an average, a balance a sum).
                for f in st["from"]:
                    if f not in decided and not f.startswith(("db2:", "cics:", "file:", "call:")):
                        nodes = tr.lineage(name, f, 5, st["line"], None, s.para)
                        if nodes:
                            decided[f] = nodes
            outcome.append(o)
    common = [g for g in t["applies_when"] if all(any(g["line"] == h["line"] and g["condition"] == h["condition"] for h in tt["applies_when"]) for tt in traces)]
    if len(traces) > 1:
        for s, tt in zip(reps.values(), traces):
            branches.append({"line": s.line, "when": [g["condition"] for g in tt["applies_when"] if g not in common],
                             "sets": [o for o in outcome if any(o["line"] in range(x.line, x.end + 1) for x, _ in members if tuple(g.render() for g in x.guards) == tuple(g.render() for g in s.guards))]})
    holder = {"applies_when": t["applies_when"], "traces": traces, "decided_by": decided}
    lines = _evidence_lines(holder, prog.path, [s for s, _ in members])
    return {
        "id": f"{name}:{first.line}",
        "program": name,
        "file": prog.path,
        "line": first.line,
        "paragraph": first.para,
        "outcome": outcome,
        "applies_when": [{"line": g["line"], "condition": g["condition"], "kind": g["kind"]} for g in common],
        "branches": branches,
        "decided_by": {f: _origins(nodes) for f, nodes in decided.items()},
        "reached_from": [{"program": c["program"], "line": c["line"], "when": [w["condition"] for w in c.get("when", [])]} for c in t["reached_from"]["programs"]],
        "returned_to": [r for tt in traces for o in tt["outcome"] for r in o.get("returned_to", [])][:8],
        "review": tr.review,
        "source": lines,
    }


def _origins(nodes: list[dict], depth: int = 0) -> list[dict]:
    """The places a field's value comes from, flattened: a database column, a screen, CICS, a literal, a calling program."""
    out = []
    for n in nodes:
        entry = {"program": n.get("program"), "file": n.get("file"), "line": n.get("line"), "text": (n.get("text") or "")[:100], "how": n.get("how")}
        if "value" in n:
            entry["value"] = n["value"]
        ext = [src["external"] for src in n.get("from", []) if "external" in src]
        if ext:
            entry["origin"] = ext
        if n.get("as"):
            entry["as"] = n["as"]
        if n.get("intended_as"):
            entry["intended_as"] = n["intended_as"]
        for k in ("callee", "started_by"):
            if n.get(k):
                entry[k] = n[k]
        out.append(entry)
        if depth < 4:
            for src in n.get("from", []):
                if src.get("set_by"):
                    out += _origins(src["set_by"], depth + 1)
            for k in ("set_by", "set_by_intended"):
                if n.get(k):
                    out += _origins(n[k], depth + 1)
    return out[:32]


def _evidence_lines(t: dict, own_file: str, block, limit: int = 70) -> dict[str, list[list]]:
    """The cited source lines, as written: the block, its guards, the definitions and the caller's side."""
    from .bench import spans

    want: dict[str, set[int]] = {}
    for f, a, b in spans(t):
        for ln in range(a, min(b, a + 6) + 1):
            want.setdefault(f, set()).add(ln)
    for s in block:
        for ln in range(s.line, s.end + 1):
            want.setdefault(own_file, set()).add(ln)
    return {f: sorted(ls)[:limit] for f, ls in want.items()}


def with_text(root: Path, packets: list[dict]) -> list[dict]:
    """Attach each cited line's text (columns 7-72), so the packet stands on its own."""
    cache: dict[str, list[str]] = {}
    for p in packets:
        src = {}
        for f, lines in p["source"].items():
            if f not in cache:
                try:
                    cache[f] = read_text(root / f).splitlines()
                except OSError:
                    cache[f] = []
            text = cache[f]
            src[f] = [[ln, text[ln - 1][6:72].rstrip()] for ln in lines if 0 < ln <= len(text) and text[ln - 1][6:7] not in "*/"]
        p["source"] = src
    return packets


def main(argv: list[str]) -> int:
    root = Path(argv[0])
    names = argv[argv.index("--programs") + 1].split(",") if "--programs" in argv else None
    m = Model(root)
    packets = with_text(root, candidates(m, names))
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else None
    text = json.dumps(packets, indent=1, ensure_ascii=False)
    if out:
        out.write_text(text, encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    for p in packets:
        cond = " AND ".join(g["condition"] for g in p["applies_when"] if business(g["condition"], g["kind"]))
        sets = ", ".join(f"{o['field']}={o.get('value', '…')}" for o in p["outcome"])
        print(f"{p['id']:<16} {sets[:50]:<50} when {cond[:110]}  · review {len(p['review'])}")
    print(f"{len(packets)} candidates", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
