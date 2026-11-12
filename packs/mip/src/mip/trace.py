"""
Trace one statement (P3, B25): when it applies, how it is reached, what decides it, and where
its outcome goes, across programs, every step cited.

    python -m mip.trace <root> <PROGRAM> <line> [--json out.json]

- applies when: the conditions the statement sits under in its paragraph (flow.py guards,
  earlier exits included);
- reached from: the PERFORM chains inside the program, and the programs that LINK or XCTL
  to it, each with the conditions at its call site;
- decided by: for every field in those conditions, where it is set, followed backwards
  through MOVE/COMPUTE/SQL/CICS and across program boundaries through the COMMAREA, matched
  by byte offset (the layouts of P2);
- outcome: what the statement's block sets, and where the calling program reads it;
- review: every place static analysis has to stop (a value set at run time, a target held in
  data, an interface that doesn't line up). These are the questions for a person, or for the
  model to propose an answer to, marked as a proposal; never filled in as fact.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from .analyze import analyze_repo
from .flow import NOT_DATA, Flow, Stmt, build, walk
from .interfaces import callee_view
from .layout import Layout, flatten, relative

_NAME = re.compile(r"\b[A-Z][A-Z0-9-]*[A-Z0-9]\b|\b[A-Z]\b")


class Model:
    def __init__(self, root: Path):
        keep: dict = {}
        self.map = analyze_repo(root, keep=keep)
        self.programs = keep["programs"]
        self.index = keep["index"]
        self.edges = [e for p in self.map["parts"] for e in p["edges"]]
        self.interfaces = [i for p in self.map["parts"] for i in p.get("interfaces", [])]
        self._flows: dict[str, Flow] = {}
        # Transaction id -> program, from the CSD or the CICS resource definitions.
        self.transactions = {x["name"]: x["unit"] for p in self.map["parts"] for x in p.get("entries", []) if x.get("kind") == "transaction"}

    def flow(self, name: str) -> Flow:
        if name not in self._flows:
            self._flows[name] = build(self.programs[name])
        return self._flows[name]

    def links_from(self, name: str) -> list[dict]:
        """The LINKs a program makes with a COMMAREA, each with the programs it can reach."""
        out = []
        for e in self.edges:
            if e["from"] == name and e["kind"] == "links" and e.get("commarea"):
                targets = (e.get("dynamic") or {}).get("resolved") or [e["to"]]
                out.append({**e, "targets": [t for t in targets if t in self.programs]})
        return out

    def children(self, name: str) -> list[tuple[dict, str]]:
        """The programs a program starts asynchronously (EXEC CICS RUN TRANSID), through the transaction definitions."""
        out = []
        for e in self.edges:
            if e["from"] == name and e.get("asynchronous"):
                for tx in (e.get("dynamic") or {}).get("resolved") or [e["to"].replace("TX:", "")]:
                    prog = self.transactions.get(tx)
                    if prog in self.programs:
                        out.append((e, prog))
        return out

    def agreed(self, caller: str, callee: str, line: int) -> bool:
        """P2 checked this hand-off and found the two sides agree (same, compatible, or the extra bytes never read):
        a field past the caller's area is the callee's own extension, not a question for a person."""
        return any(i["caller"] == caller and i["callee"] == callee and i["line"] == line and i["verdict"] in ("same", "compatible", "not_read") for i in self.interfaces)

    def callers(self, name: str) -> list[dict]:
        out = []
        for e in self.edges:
            if e["kind"] not in ("links", "transfers") or e["from"] not in self.programs:
                continue
            if e["to"] == name or name in (e.get("dynamic") or {}).get("resolved", []):
                out.append(e)
        return out


def _fields_in(text: str) -> list[str]:
    return [w for w in dict.fromkeys(_NAME.findall(text.upper())) if w not in NOT_DATA and not w.isdigit()]


# Fields that only say whether the last call worked: return codes, response codes, end-of-file switches.
TECHNICAL = re.compile(
    r"^(SQLCODE|SQLSTATE|EIBRESP2?|EIBCALEN|EIBAID|DFH[A-Z0-9]*|NORMAL|.*-RESP2?|.*RESP-CD|.*-RESP-CODE|DB2-.*|WS-STORM.*"
    r"|.*-EOF|END-OF-.*|.*FILE-STATUS|.*ABEND.*|CEE[0-9A-Z]{3}|FC|.*-FEEDBACK.*)$"
)
_LITERAL = re.compile(r"'[^']*'|\"[^\"]*\"")


def business(condition: str, kind: str = "if") -> bool:
    """A condition about the business, not only about whether the last call worked. Loop controls
    (PERFORM UNTIL / VARYING) say how often, not whether, so they never make a rule."""
    if kind == "loop":
        return False
    fields = _fields_in(_LITERAL.sub(" ", condition))
    return bool(fields) and not all(TECHNICAL.match(f) for f in fields)


def _container_gets(nodes: list[dict], depth: int = 0) -> list[str]:
    """The groups a lineage shows filled by EXEC CICS GET CONTAINER INTO, nearest first."""
    out = []
    for n in nodes:
        if any(str(x.get("external", "")).startswith("cics:GET.INTO") for x in n.get("from", [])) and n.get("sets"):
            out.append(n["sets"])
        if depth < 6:
            for x in n.get("from", []):
                out += _container_gets(x.get("set_by") or [], depth + 1)
    return out


def _cite(prog, line: int, text: str, **extra) -> dict:
    return {"program": prog.name, "file": prog.path, "line": line, "text": text, **extra}


def _guards(prog, guards) -> list[dict]:
    return [{"file": prog.path, "line": g.line, "end": max(g.end, g.line), "kind": g.kind, "condition": g.render()} for g in guards]


def _stmt(prog, s, **extra) -> dict:
    from .flow import last_line

    return {"program": prog.name, "file": prog.path, "line": s.line, "end": last_line(s), "text": s.text(), **extra}


def _suffix(name: str) -> str:
    return name.split("-", 1)[1] if "-" in name else name


class Tracer:
    def __init__(self, model: Model, per_field: int = 3):
        self.m = model
        self.per_field = per_field
        self.review: list[dict] = []
        self.seen_review: set = set()

    def flag(self, kind: str, question: str, evidence: list[dict]) -> None:
        key = (kind, question)
        if key not in self.seen_review:
            self.seen_review.add(key)
            self.review.append({"kind": kind, "question": question, "evidence": evidence, "status": "needs review"})

    # ── within a program ────────────────────────────────────────────────────
    def reached_from(self, flow: Flow, para: str, depth: int = 0, seen: frozenset = frozenset()) -> list[list[dict]]:
        """PERFORM chains from the program's entry to a paragraph (a PERFORM of its section or a THRU range counts)."""
        names = [p.name for p in flow.paragraphs]
        target = next((p for p in flow.paragraphs if p.name == para), None)
        if not target or depth > 8 or para in seen:
            return []
        if flow.paragraphs and (para == flow.paragraphs[0].name or (target.section and target.section == flow.paragraphs[0].name)):
            return [[]]
        chains = []
        for holder, s, to, thru in flow.performs():
            hit = to == para or (target.section and to == target.section)
            if not hit and thru and to in names and thru in names:
                hit = names.index(to) <= names.index(para) <= names.index(thru)
            if not hit:
                continue
            step = {"paragraph": holder.name, "line": s.line, "text": s.text(), "when": [g.render() for g in s.guards]}
            for up in self.reached_from(flow, holder.name, depth + 1, seen | {para}) or [[]]:
                chains.append(up + [step])
                if len(chains) >= 6:
                    return chains
        return chains

    def defs(self, flow: Flow, field: str) -> list[Stmt]:
        return [s for s in flow.statements() if any(x["field"] == field for x in s.sets)]

    # ── decided by: where a field's value comes from ────────────────────────
    def reaching(self, flow: Flow, field: str, before: int | None, para: str | None) -> list[Stmt]:
        """Definitions that can reach a use: in the use's own paragraph only those before it (sequential code);
        elsewhere any (another paragraph may run first). The nearest few, nearest first."""
        use = flow.at(before) if before is not None else None
        loops = {g.line for g in use.guards if g.kind == "loop"} if use else set()
        found = []
        for s in self.defs(flow, field):
            if before is not None and para is not None and s.para == para and s.line >= before:
                # Later in the text, but inside the same loop: it ran on the previous pass.
                if not loops & {g.line for g in s.guards if g.kind == "loop"}:
                    continue
            found.append(s)
        # Error paths (only technical conditions: SQLCODE, RESP…) come after the main path: when the cap cuts, the
        # definitions that make the business value survive.
        def rank(s: Stmt) -> tuple:
            branch = [g for g in s.guards if g.kind in ("if", "else", "when", "other")]
            return (any(not business(g.text, g.kind) for g in branch), len(branch))

        same = sorted((s for s in found if s.para == para), key=lambda s: (*rank(s), -s.line))
        other = sorted((s for s in found if s.para != para), key=lambda s: (*rank(s), -(s.line if before is None or s.line < before else 0)))
        return (same + other)[: self.per_field]

    def lineage(self, prog_name: str, field: str, depth: int, before: int | None = None, visited: set | None = None, para: str | None = None) -> list[dict]:
        visited = visited if visited is not None else set()
        key = (prog_name, field)
        if key in visited or depth < 0:
            return []
        visited.add(key)
        prog = self.m.programs[prog_name]
        flow = self.m.flow(prog_name)
        out = []
        for s in self.reaching(flow, field, before, para):
            for st in (x for x in s.sets if x["field"] == field):
                node = _stmt(prog, s, how=st["how"], sets=field, when=_guards(prog, s.guards))
                if st.get("literal") is not None:
                    node["value"] = st["literal"]
                sources = []
                for src in st["from"]:
                    if src.startswith(("db2:", "cics:", "file:", "call:")) or src == "input":
                        sources.append({"external": src})
                        if src.startswith("cics:GET.INTO") and depth > 0:
                            replies = self.replies(prog_name, field, field, depth - 1, visited)
                            if replies:
                                sources.append({"field": field, "set_by": replies})
                        if src.split(".")[0] in ("cics:INQUIRE", "cics:ASSIGN"):
                            self.flag("runtime_value", f"{field} in {prog_name} is set at run time by EXEC CICS ({src[5:]}); which values it takes can't be read from source", [node])
                        if src.startswith("call:"):
                            self.flag("may_be_set_by_call", f"{field} in {prog_name} may be changed by the called program {src[5:]}", [node])
                    elif depth > 0:
                        sub = self.lineage(prog_name, src, depth - 1, st["line"], visited, s.para)
                        if sub:
                            sources.append({"field": src, "set_by": sub})
                        else:
                            sources.append({"field": src})
                if sources:
                    node["from"] = sources
                out.append(node)
        out += self.returned(prog_name, field, depth, before, visited, para)
        if not out:
            out = self.through_parent(prog_name, prog, field, depth, before, visited, para)
        if not out:
            # Not set here: is it part of the COMMAREA this program receives? Then it comes from the callers.
            out = self.across(prog_name, field, depth, visited)
        return out

    def through_parent(self, prog_name, prog, field, depth, before, visited, para) -> list[dict]:
        """A condition name (88) is decided by its field; a field inside a group is set whenever the group is
        (READ … INTO(SEC-USER-DATA) sets SEC-USR-PWD)."""
        lay = Layout(prog, self.m.index.view(prog.path))
        item = lay.find(field)
        if not item or not item.parent:
            return []
        if item.level == 88:
            values = ", ".join(f"'{v}'" for v in item.values) or "?"
            return [{"program": prog_name, "file": item.path, "line": item.line, "text": f"88 {field} VALUE {values}", "how": f"condition name of {item.parent}",
                     "from": [{"field": item.parent, "set_by": self.lineage(prog_name, item.parent, depth, before, visited, para)}]}]
        parent = item.parent
        chain = []
        while parent and len(chain) < 6:
            sub = self.lineage(prog_name, parent, depth, before, visited, para)
            if sub:
                node = {"program": prog_name, "file": item.path, "line": item.line, "text": f"{field} is part of {parent}", "how": "group", "from": [{"field": parent, "set_by": sub}]}
                # A group (at any level above) filled from a container: this field is the part at its offset in what
                # the started programs PUT, so follow this field, not the whole record.
                if depth > 0:
                    for g in _container_gets(sub):
                        replies = self.replies(prog_name, g, field, depth - 1, visited)
                        if replies:
                            node["from"].append({"field": field, "set_by": replies})
                            break
                return [node]
            p = lay.find(parent)
            chain.append(parent)
            parent = p.parent if p else None
        return []

    def part_of(self, prog, group: str, field: str):
        """(offset, size) of a field inside a group; for the group itself, 0 and its whole size."""
        lay = Layout(prog, self.m.index.view(prog.path))
        item = lay.find(group) if group else None
        if not item:
            return None
        node = lay.node(item)
        if field == group:
            return 0, node.total
        hit = next((x for x in relative(flatten(node), node.offset) if x["name"] == field), None)
        return (hit["offset"], hit["size"]) if hit else None

    def returned(self, prog_name: str, field: str, depth: int, before, visited: set, para) -> list[dict]:
        """A field inside the COMMAREA a program LINKs with is set by the called program: the LINK is a definition,
        and the value is whatever the callee puts at the same offset of its DFHCOMMAREA."""
        prog = self.m.programs[prog_name]
        flow = self.m.flow(prog_name)
        out = []
        for e in self.m.links_from(prog_name):
            line = e["cite"]["line"]
            at = flow.at(line)
            if before is not None and at is not None and at.para == para and line >= before:
                continue
            name = e["commarea"].split(" OF ")[0].split(" IN ")[0].strip()
            pos = self.part_of(prog, name, field)
            if not pos:
                continue
            for callee in e["targets"]:
                cp = self.m.programs[callee]
                view = callee_view(cp, self.m.index.view(cp.path)) or {}
                f = next((x for x in view.get("fields", []) if x["offset"] == pos[0]), None)
                hop = {"program": prog_name, "file": prog.path, "line": line, "end": at.end if at else line,
                       "text": f"LINK {callee} COMMAREA({e['commarea']})", "how": "returned by LINK", "callee": callee,
                       "as": f["name"] if f else None, "when": _guards(prog, at.guards) if at else []}
                if f and depth > 0:
                    sub = self.lineage(callee, f["name"], depth - 1, None, visited, None)
                    if sub:
                        hop["set_by"] = sub
                out.append(hop)
        return out[: self.per_field]

    def replies(self, prog_name: str, group: str, field: str, depth: int, visited: set) -> list[dict]:
        """A container read back from programs this one started (EXEC CICS RUN TRANSID, then FETCH and GET
        CONTAINER): the field is what each started program PUT at the same offset."""
        prog = self.m.programs[prog_name]
        pos = self.part_of(prog, group, field)
        if not pos:
            return []
        out = []
        for e, child in self.m.children(prog_name):
            cp = self.m.programs[child]
            lay = Layout(cp, self.m.index.view(cp.path))
            for s in self.m.flow(child).statements():
                words = [t.upper for t in s.tokens]
                if s.kind != "EXEC" or words[2:3] != ["PUT"] or "FROM" not in words:
                    continue
                k = words.index("FROM")
                src = words[k + 2] if k + 2 < len(words) else None
                item = lay.find(src) if src else None
                if not item:
                    continue
                node = lay.node(item)
                hit = next((x for x in relative(flatten(node), node.offset) if x["offset"] == pos[0] and x["size"] == pos[1]), None)
                name = hit["name"] if hit else (src if pos[0] == 0 else None)
                hop = {"program": child, "file": cp.path, "line": s.line, "end": s.end, "text": s.text(), "how": "PUT CONTAINER (reply)", "as": name,
                       "started_by": {"program": prog_name, "file": prog.path, "line": e["cite"]["line"],
                                      "transid": next((t for t, p in self.m.transactions.items() if p == child), None)}}
                if name:
                    sub = self.lineage(child, name, depth, s.line, visited, s.para)
                    if sub:
                        hop["set_by"] = sub
                out.append(hop)
        return out[:6]

    def commarea_offset(self, prog_name: str, field: str):
        prog = self.m.programs[prog_name]
        view = callee_view(prog, self.m.index.view(prog.path))
        if not view or not view.get("fields"):
            return None, view
        f = next((x for x in view["fields"] if x["name"] == field), None)
        return f, view

    def declared(self, prog_name: str, f: dict) -> list[dict]:
        """Where the called program declares what it receives: its DFHCOMMAREA, the COPY under it, the field itself."""
        prog = self.m.programs[prog_name]
        out = []
        dfh = prog.data.get("DFHCOMMAREA")
        if dfh:
            out.append({"file": prog.path, "line": dfh.line, "text": "01 DFHCOMMAREA"})
            for m in (x for x in prog.items if x.copy and x.parent == "DFHCOMMAREA"):
                out.append({"file": prog.path, "line": m.line, "text": f"COPY {m.copy}"})
        if f.get("file"):
            out.append({"file": f["file"], "line": f["line"], "text": f["name"]})
        return out

    def caller_field(self, caller, edge: dict, offset: int, callee_field: str):
        lay = Layout(caller, self.m.index.view(caller.path))
        name = (edge.get("commarea") or "").split(" OF ")[0].strip()
        item = lay.find(name) if name else None
        if not item:
            return None, None, None
        node = lay.node(item)
        fields = relative(flatten(node), node.offset)
        by_pos = next((x for x in fields if x["offset"] <= offset < x["offset"] + max(x["size"], 1)), None)
        by_name = next((x for x in fields if _suffix(x["name"]) == _suffix(callee_field)), None)
        return by_pos, by_name, node.total

    def across(self, prog_name: str, field: str, depth: int, visited: set) -> list[dict]:
        f, view = self.commarea_offset(prog_name, field)
        if not f:
            return []
        out = []
        for e in self.m.callers(prog_name):
            caller = self.m.programs[e["from"]]
            by_pos, by_name, size = self.caller_field(caller, e, f["offset"], field)
            link = self.m.flow(caller.name).at(e["cite"]["line"])
            hop = {"program": caller.name, "file": caller.path, "line": e["cite"]["line"], "end": link.end if link else e["cite"]["line"],
                   "text": f"{e.get('command', 'LINK')} {prog_name} COMMAREA({e.get('commarea')})",
                   "how": "COMMAREA", "passes": f"{field} (offset {f['offset']}, {f['size']} bytes)", "declared": self.declared(prog_name, f)}
            if by_pos and by_pos["offset"] == f["offset"]:
                hop["as"] = by_pos["name"]
                at = self.m.flow(caller.name).at(e["cite"]["line"])
                sub = self.lineage(caller.name, by_pos["name"], depth - 1, e["cite"]["line"], visited, at.para if at else None) if depth > 0 else []
                if sub:
                    hop["set_by"] = sub
            else:
                hop["as"] = None
                ev = [{"program": caller.name, "file": caller.path, "line": e["cite"]["line"], "text": hop["text"]}]
                where = f"at offset {f['offset']} {caller.name} has {by_pos['name'] + ' (offset ' + str(by_pos['offset']) + ')' if by_pos else 'nothing: its area is ' + str(size) + ' bytes'}"
                if by_name:
                    where += f"; by name it would be {by_name['name']} at offset {by_name['offset']}"
                if not self.m.agreed(caller.name, prog_name, e["cite"]["line"]):
                    self.flag("interface", f"{prog_name}.{field} does not line up with what {caller.name} passes: {where}", ev)
                if by_name and depth > 0:
                    hop["intended_as"] = by_name["name"]
                    at = self.m.flow(caller.name).at(e["cite"]["line"])
                    sub = self.lineage(caller.name, by_name["name"], depth - 1, e["cite"]["line"], visited, at.para if at else None)
                    if sub:
                        hop["set_by_intended"] = sub
            out.append(hop)
        return out

    # ── outcome: what the block sets and where the caller reads it ─────────
    def block_of(self, flow: Flow, target: Stmt) -> list[Stmt]:
        def find(stmts):
            if any(s is target for s in stmts):
                return stmts
            for s in stmts:
                for sub in (s.then, s.els, *[b for _, b, _ in s.branches]):
                    r = find(sub)
                    if r is not None:
                        return r
            return None

        for p in flow.paragraphs:
            r = find(p.body)
            if r is not None:
                return r
        return [target]

    def outcome(self, prog_name: str, target: Stmt) -> list[dict]:
        prog = self.m.programs[prog_name]
        flow = self.m.flow(prog_name)
        out = []
        for s in self.block_of(flow, target):
            for st in s.sets:
                node = _stmt(prog, s, sets=st["field"], **({"value": st["literal"]} if st.get("literal") is not None else {}))
                f, _ = self.commarea_offset(prog_name, st["field"])
                if f:
                    node["returned_to"] = []
                    for e in self.m.callers(prog_name):
                        if e["kind"] != "links":
                            continue  # an XCTL never comes back: nothing is returned to the program that transferred
                        caller = self.m.programs[e["from"]]
                        by_pos, by_name, size = self.caller_field(caller, e, f["offset"], st["field"])
                        aligned = by_pos and by_pos["offset"] == f["offset"] and by_pos["size"] == f["size"]
                        seen_as = by_pos["name"] if aligned else None
                        intended = by_name["name"] if by_name else None
                        uses = self.uses_after(caller.name, intended or seen_as, e["cite"]["line"], st.get("literal")) if (intended or seen_as) else []
                        node["returned_to"].append({"program": caller.name, "line": e["cite"]["line"], "seen_as": seen_as, "intended_as": intended, "uses": uses})
                        if not aligned and not self.m.agreed(caller.name, prog_name, e["cite"]["line"]):
                            self.flag("interface", f"{caller.name} reads {intended or 'nothing'} where {prog_name} returns {st['field']} (offset {f['offset']}): by position {caller.name} has {by_pos['name'] + ' at ' + str(by_pos['offset']) if by_pos else 'nothing (its area is ' + str(size) + ' bytes)'}", [{"program": caller.name, "file": caller.path, "line": e["cite"]["line"], "text": f"LINK {prog_name}"}])
                out.append(node)
        return out

    def uses_after(self, prog_name: str, field: str, after: int, value: str | None) -> list[dict]:
        prog = self.m.programs[prog_name]
        flow = self.m.flow(prog_name)
        out = []
        for s in flow.statements():
            if s.line <= after or field not in s.reads:
                continue
            item = _cite(prog, s.line, s.text())
            if s.kind == "EVALUATE" and value is not None:
                for cond, body, kind in s.branches:
                    if any(t.text == value for t in cond):
                        item["branch"] = [_stmt(prog, b) for b in body]
            elif s.kind == "IF":
                item["then"] = [_stmt(prog, b) for b in s.then][:3]
                item["else"] = [_stmt(prog, b) for b in s.els][:3]
            out.append(item)
            if len(out) >= 4:
                break
        return out

    def then(self, flow: Flow, prog, target: Stmt, limit: int = 6) -> list[dict]:
        """What runs next in the same block, up to the next transfer of control."""
        from .flow import transfers

        block = self.block_of(flow, target)
        k = next((i for i, s in enumerate(block) if s is target), len(block))
        out = []
        for s in block[k + 1 : k + 1 + limit]:
            out.append(_stmt(prog, s))
            if transfers(s):
                break
        return out

    # ── the whole trace ─────────────────────────────────────────────────────
    def trace(self, prog_name: str, line: int, depth: int = 3) -> dict:
        prog = self.m.programs[prog_name]
        flow = self.m.flow(prog_name)
        s = flow.at(line)
        if not s:
            return {"error": f"no statement at {prog_name}:{line}"}
        para = flow.paragraph_of(s)
        result = {
            "target": _stmt(prog, s, paragraph=s.para, section=para.section if para else None),
            "applies_when": _guards(prog, s.guards),
            "then": self.then(flow, prog, s),
            "reached_from": {"within": self.reached_from(flow, s.para) if s.para else [], "programs": []},
            "decided_by": {},
        }
        for e in self.m.callers(prog_name):
            caller = self.m.programs[e["from"]]
            cs = self.m.flow(caller.name).at(e["cite"]["line"])
            result["reached_from"]["programs"].append({
                **(_stmt(caller, cs, command=e.get("command")) if cs else _cite(caller, e["cite"]["line"], e.get("command", ""))),
                "when": _guards(caller, cs.guards) if cs else [],
                "paragraph": cs.para if cs else None,
            })
        fields = []
        for g in s.guards:
            fields += _fields_in(g.text)
        fields += [r for r in s.reads]
        for f in dict.fromkeys(fields):
            if self.m.programs[prog_name].data.get(f) is None and not Layout(prog, self.m.index.view(prog.path)).find(f):
                continue  # a condition name or something that isn't a field here
            result["decided_by"][f] = self.lineage(prog_name, f, depth, line, None, s.para)
        result["outcome"] = self.outcome(prog_name, s)
        for g in s.guards:
            for f in _fields_in(g.text):
                if not result["decided_by"].get(f) and f in prog.data:
                    pass
        result["review"] = self.review
        return result


def render(t: dict) -> str:
    """The trace as text a person reads."""
    if "error" in t:
        return t["error"]
    L = []
    tg = t["target"]
    L.append(f"{tg['program']} {tg['file']}:{tg['line']}  {tg['text']}")
    L.append(f"  in {tg['paragraph']}{' (section ' + tg['section'] + ')' if tg.get('section') else ''}")
    L.append("\nAPPLIES WHEN")
    for g in t["applies_when"]:
        L.append(f"  {g['line']:>5}  {g['condition']}")
    if t.get("then"):
        L.append("\nTHEN")
        for s in t["then"]:
            L.append(f"  {s['line']:>5}  {s['text'][:90]}")
    L.append("\nREACHED FROM")
    for chain in t["reached_from"]["within"]:
        L.append("  " + " → ".join(f"{s['paragraph']}:{s['line']}" + (f" [{'; '.join(s['when'])}]" if s["when"] else "") for s in chain) + f" → {tg['paragraph']}")
    for c in t["reached_from"]["programs"]:
        L.append(f"  {c['program']}:{c['line']} {c['text'][:60]}" + (f"  when {'; '.join(w['condition'] for w in c['when'])[:120]}" if c["when"] else ""))
    L.append("\nDECIDED BY")

    def walk_lineage(nodes, indent):
        for n in nodes:
            what = n.get("how")
            extra = f" = {n['value']}" if "value" in n else ""
            where = n["file"].rsplit("/", 1)[-1] if n.get("file") else n["program"]
            L.append(f"{' ' * indent}{where}:{n['line']}  {n['text'][:80]}{extra}  ({what})")
            if n.get("when"):
                L.append(f"{' ' * (indent + 4)}when {'; '.join(w['condition'] for w in n['when'])[:110]}")
            for src in n.get("from", []):
                if "external" in src:
                    L.append(f"{' ' * (indent + 4)}from {src['external']}")
                elif src.get("set_by"):
                    L.append(f"{' ' * (indent + 4)}{src['field']} ←")
                    walk_lineage(src["set_by"], indent + 6)
            for k in ("set_by", "set_by_intended"):
                if n.get(k):
                    L.append(f"{' ' * (indent + 4)}{'as ' + n['as'] if k == 'set_by' else 'intended as ' + n.get('intended_as', '?')} ←")
                    walk_lineage(n[k], indent + 6)

    for f, nodes in t["decided_by"].items():
        L.append(f"  {f}")
        walk_lineage(nodes, 4)
    L.append("\nOUTCOME")
    for o in t["outcome"]:
        L.append(f"  {o['program']}:{o['line']}  {o['text'][:70]}")
        for r in o.get("returned_to", []):
            L.append(f"      → {r['program']}:{r['line']} seen as {r['seen_as'] or 'nothing (by position)'}" + (f", intended as {r['intended_as']}" if r["intended_as"] and r["intended_as"] != r["seen_as"] else ""))
            for u in r["uses"]:
                L.append(f"          {u['line']}  {u['text'][:70]}")
                for b in u.get("branch", []):
                    L.append(f"             → {b['line']}  {b['text'][:70]}")
    L.append("\nNEEDS REVIEW")
    for r in t["review"]:
        L.append(f"  [{r['kind']}] {r['question']}")
    return "\n".join(L)


def main(argv: list[str]) -> int:
    root, prog, line = Path(argv[0]), argv[1].upper(), int(argv[2])
    t = Tracer(Model(root)).trace(prog, line)
    if "--json" in argv:
        Path(argv[argv.index("--json") + 1]).write_text(json.dumps(t, indent=1, ensure_ascii=False), encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(render(t))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
