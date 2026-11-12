"""
Interface checks (P2): for every CICS LINK and XCTL that passes a COMMAREA to a program in
the repository, compare what the caller passes with what the called program reads, byte for
byte. The called program reads its DFHCOMMAREA (LINKAGE SECTION); when that is an untyped
byte array (CardDemo's `LK-COMMAREA OCCURS … DEPENDING ON EIBCALEN`), it reads the record
it MOVEs DFHCOMMAREA into.

A finding names the first byte where the two layouts disagree, every field the called
program reads beyond what the caller passes, and the lines of both declarations, so a
steward can open both and see it. Static analysis: what happens at run time depends on
how CICS passes the area, which is said, not assumed.
"""
from __future__ import annotations

from .cobol import Program
from .layout import Layout, flatten, relative


def _record(lay: Layout, name: str):
    item = lay.find(name.split(" OF ")[0].split(" IN ")[0].strip())
    if not item:
        return None, None
    node = lay.node(item)
    return item, relative(flatten(node), node.offset), node.total


def callee_view(callee: Program, copybooks: dict[str, Program]) -> dict | None:
    """What the called program reads: its typed DFHCOMMAREA, or the record it copies an untyped one into."""
    lay = Layout(callee, copybooks)
    dfh = callee.data.get("DFHCOMMAREA") or lay.find("DFHCOMMAREA")
    if not dfh:
        return None
    node = lay.node(dfh)
    fields = relative(flatten(node), node.offset)
    kids = [c for c in dfh.children if c.level not in (66, 88)]
    untyped = not kids or any(c.depending for c in kids) or (len(kids) == 1 and bool(kids[0].occurs) and not kids[0].children)
    if not untyped and fields:
        return {"record": "DFHCOMMAREA", "line": dfh.line, "file": dfh.path, "fields": fields, "size": node.total, "typed": True}
    for mv in callee.commarea_copy:
        item, f2, size = _record(lay, mv["to"]) if lay.find(mv["to"]) else (None, None, None)
        if item:
            return {"record": mv["to"], "line": item.line, "file": item.path, "fields": f2, "size": size, "typed": False, "via_move": mv["line"], "bounded": mv.get("bounded", False)}
    if "DFHCOMMAREA" not in callee.used:
        # It checks EIBCALEN at most, and never reads what it is passed (CardDemo's sign-on, COSGN00C).
        return {"record": "DFHCOMMAREA", "line": dfh.line, "file": dfh.path, "fields": [], "size": 0, "typed": False, "not_read": True}
    return {"record": "DFHCOMMAREA", "line": dfh.line, "file": dfh.path, "fields": fields, "size": node.total, "typed": False, "opaque": True}


def compare(caller_fields: list[dict], caller_size: int, callee_fields: list[dict], callee_size: int, used: set | None = None, bounded: bool = False) -> dict:
    """Compatibility, not identity. A field the called program takes is compatible when it lies inside one of the
    caller's fields (the caller passes those bytes opaquely, e.g. PIC X(200)), or covers whole caller fields exactly,
    and ends within what was passed. With a bounded copy (MOVE DFHCOMMAREA(1:EIBCALEN) TO …) the called program's
    fields past the caller's length are its own, not taken from the caller.
    High: a conflicting field the called program uses. Low: conflicts only in fields it never mentions."""
    a = {(f["offset"], f["size"]) for f in caller_fields}
    b = {(f["offset"], f["size"]) for f in callee_fields}
    if caller_size == callee_size and a == b:
        return {"verdict": "same"}
    used = used if used is not None else {g["name"] for g in callee_fields}
    taken = [g for g in callee_fields if not (bounded and g["offset"] >= caller_size)]

    def compatible(g: dict) -> bool:
        end = g["offset"] + g["size"]
        if end > caller_size:
            return False
        over = [f for f in caller_fields if f["offset"] < end and g["offset"] < f["offset"] + f["size"]]
        if not over:
            return True
        if len(over) == 1 and over[0]["offset"] <= g["offset"] and end <= over[0]["offset"] + over[0]["size"]:
            return True
        return all(g["offset"] <= f["offset"] and f["offset"] + f["size"] <= end for f in over)

    conflicts = [g for g in taken if not compatible(g)]
    if not conflicts:
        note = None
        if callee_size > caller_size and bounded:
            note = "the called program extends the area with fields of its own, beyond what the caller passes (it copies only the bytes passed)"
        elif caller_size > callee_size:
            note = "the caller passes more than the called program reads"
        return {"verdict": "same" if caller_size == callee_size else "compatible", **({"note": note} if note else {})}
    first = min(conflicts, key=lambda g: g["offset"])
    over = [f for f in caller_fields if f["offset"] <= first["offset"] < f["offset"] + max(f["size"], 1)]
    risky = [_brief(g) for g in conflicts if g["name"] in used]
    return {
        "verdict": "differs",
        "severity": "high" if risky else "low",
        "caller_size": caller_size,
        "callee_size": callee_size,
        "first_difference": {"offset": first["offset"], "callee_field": _brief(first), "caller_field": _brief(over[0]) if over else None},
        "conflicting_fields": [_brief(g) for g in conflicts],
        **({"used_by_callee": risky} if risky else {}),
        **({"callee_reads_beyond_caller": [_brief(g) for g in conflicts if g["offset"] >= caller_size]} if any(g["offset"] >= caller_size for g in conflicts) else {}),
    }


def _brief(f: dict | None) -> dict | None:
    if not f:
        return None
    return {"name": f["name"], "offset": f["offset"], "size": f["size"], "line": f["line"], "file": f["file"]}


def check(caller: Program, edge: dict, programs: dict[str, Program], view) -> dict | None:
    """One LINK or XCTL: the caller's COMMAREA against the called program's view. None when either side is unknown."""
    target = edge["to"]
    commarea = edge.get("commarea")
    if not commarea or target not in programs:
        return None
    lay = Layout(caller, view(caller.path))
    item, fields, size = _record(lay, commarea) if lay.find(commarea.split(" OF ")[0].split(" IN ")[0].strip()) else (None, None, None)
    view = callee_view(programs[target], view(programs[target].path))
    base = {"caller": caller.name, "callee": target, "command": edge.get("command"), "line": edge["cite"]["line"], "file": edge["cite"]["file"], "commarea": commarea}
    if not item:
        return {**base, "verdict": "unknown", "why": f"{commarea} not found in {caller.name} or its copybooks"}
    if not view:
        return {**base, "verdict": "unknown", "why": f"{target} has no DFHCOMMAREA"}
    if view.get("not_read"):
        return {**base, "verdict": "not_read", "why": f"{target} never reads the COMMAREA it is passed (at most it tests EIBCALEN)"}
    if view.get("opaque"):
        return {**base, "verdict": "unknown", "why": f"{target} reads DFHCOMMAREA as untyped bytes and no copy of it was found"}
    result = compare(fields, size, view["fields"], view["size"], programs[target].used, bounded=view.get("bounded", False))
    return {
        **base,
        **result,
        "caller_record": {"name": item.name, "line": item.line, "file": item.path, "size": size},
        "callee_record": {"name": view["record"], "line": view["line"], "file": view["file"], "size": view["size"], **({"via_move": view["via_move"]} if view.get("via_move") else {})},
    }
