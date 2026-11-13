"""
System-wide data lineage (P5): one data element followed forward through the whole system, by its bytes.

An element is a slice of storage: a record, an offset and a size. It moves when a statement copies those bytes
(MOVE, a group MOVE into an untyped area and back, WRITE … FROM, READ … INTO, CALL USING, a COMMAREA), and it
crosses programs through files: the DD a program writes is a dataset, the steps that read that dataset (a SORT
that may reformat it, an IDCAMS REPRO, another program, an online program through the CICS file) take it on.
A statement that computes a new value from it (COMPUTE, ADD …) starts a derived element. Every hop records
where the element's definition changes (its picture, sign, scale, editing, its position in the record), and every
statement that tests or changes it is listed as an operation on it.

Names don't matter here, bytes do: TRAN-AMT in one program and TRNX-AMT in another are the same element when
the bytes line up. Elements linked only by name (no path through the code) are for the model to propose (B3).

    python -m mip.lineage <repo> <PROGRAM> <FIELD> [--depth N] [--json out.json]
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from .analyze import list_files, role_of
from .flow import NOT_DATA, Stmt, _cond_text, _names, _split, _targets
from .jcl import analyze_jcl
from .layout import Layout, _path, flatten
from .source import read_text
from .trace import Model, business

SORT_PROGRAMS = {"SORT", "ICEMAN", "SYNCSORT", "DFSORT", "ICETOOL"}
COPY_PROGRAMS = {"IEBGENER", "ICEGENER"}


@dataclass(frozen=True)
class Slice:
    """Bytes [off, off + size) of a record: in a program's storage, or in a dataset."""

    where: str  # "mem", "ds" (a dataset) or "db" (a DB2 column)
    owner: str  # program name, or dataset name (generation removed)
    root: str  # 01 record (mem) or "" (ds)
    off: int
    size: int
    at: int = 0  # the statement where it arrived (a READ, the CALL it came back from)
    via: str = ""  # "read", "return" (a buffer filled by a call: used right after it), "call-in"

    @property
    def end(self) -> int:
        return self.off + self.size

    def key(self) -> str:
        if self.where == "ds":
            return f"ds:{self.owner}@{self.off}+{self.size}"
        if self.where == "db":
            return f"db:{self.owner}"
        return f"{self.owner}:{self.root}@{self.off}+{self.size}" + (f"#{self.via}{self.at}" if self.via in ("return", "call-in") else "")


@dataclass
class Ref:
    root: str
    off: int
    size: int
    item: object
    node: object


def base_dsn(dsn: str) -> str:
    """A dataset without its generation: SYSTRAN(+1) and SYSTRAN(0) are the same GDG."""
    return re.sub(r"\([^)]*\)$", "", dsn.strip().upper())


def generation(dsn: str) -> str | None:
    m = re.search(r"\(([+-]?\d+)\)$", dsn.strip())
    return m.group(1) if m else None


# ── Pictures: what a field holds, and what changes when a value moves ──────────

EDIT = re.compile(r"[Z*.,B0/+\-$]|CR|DB")


def describe(item) -> dict:
    """Signed, integer digits, decimals, edited, alphanumeric, usage: from PICTURE and USAGE."""
    if item is None:
        return {}
    pic = (getattr(item, "pic", None) or "").upper()
    usage = (getattr(item, "usage", None) or "DISPLAY").upper()
    if not pic:
        return {"pic": None, "group": True, "usage": usage}
    expanded = re.sub(r"(.)\((\d+)\)", lambda m: m.group(1) * int(m.group(2)), pic)
    alpha = "X" in expanded or "A" in expanded
    edited = not alpha and bool(EDIT.search(expanded.replace("S", "").replace("V", "")))
    whole, _, frac = expanded.replace("S", "").partition("V") if "V" in expanded else (expanded.replace("S", ""), "", "")
    if edited and "." in expanded:
        whole, _, frac = expanded.replace("S", "").partition(".")
    digits = lambda s: sum(1 for c in s if c in "9Z*")
    return {"pic": pic, "usage": usage, "signed": "S" in expanded or "-" in expanded or "+" in expanded or "CR" in expanded or "DB" in expanded,
            "int": digits(whole), "dec": digits(frac), "edited": edited, "alpha": alpha}


def changes(a: dict, b: dict) -> list[str]:
    """How a value's definition changes from one field to another."""
    out = []
    if not a or not b or a.get("group") or b.get("group"):
        if b.get("group") and not a.get("group"):
            out.append("carried inside an untyped group")
        return out
    if a.get("alpha") != b.get("alpha"):
        out.append("numeric becomes alphanumeric" if b.get("alpha") else "alphanumeric becomes numeric")
    if b.get("edited") and not a.get("edited"):
        out.append(f"becomes edited text for display ({b['pic']})")
    if not a.get("alpha") and not b.get("alpha"):
        if b.get("int", 0) < a.get("int", 0):
            out.append(f"integer digits {a['int']} → {b['int']}: high-order digits can be lost")
        elif b.get("int", 0) > a.get("int", 0):
            out.append(f"integer digits {a['int']} → {b['int']}")
        if b.get("dec", 0) < a.get("dec", 0):
            out.append(f"decimals {a['dec']} → {b['dec']}: truncated")
        elif b.get("dec", 0) > a.get("dec", 0):
            out.append(f"decimals {a['dec']} → {b['dec']}")
        if a.get("signed") and not b.get("signed"):
            out.append("sign lost")
    if a.get("usage") != b.get("usage"):
        out.append(f"usage {a.get('usage')} → {b.get('usage')}")
    return out


# ── SORT control statements: how a reformat moves bytes ────────────────────────

def reformat(control: str) -> list[tuple[int, int, int]] | None:
    """(out offset, in offset, length) segments of INREC/OUTREC FIELDS= or BUILD=, 0-based. None: no reformat."""
    segs = None
    for kw in ("INREC", "OUTREC"):
        m = re.search(rf"\b{kw}\s+(?:FIELDS|BUILD)\s*=\s*\((.*?)\)\s*(?:$|\n|[A-Z])", control, re.S)
        if not m:
            continue
        items = [x.strip() for x in m.group(1).replace("\n", " ").split(",")]
        mapping, pos, k = [], 0, 0
        while k < len(items):
            it = items[k]
            col = re.fullmatch(r"(\d+):(\d+)", it)
            if col and k + 1 < len(items) and items[k + 1].isdigit():
                pos, start, length = int(col.group(1)) - 1, int(col.group(2)) - 1, int(items[k + 1])
                mapping.append((pos, start, length)); pos += length; k += 2; continue
            if it.isdigit() and k + 1 < len(items) and items[k + 1].isdigit():
                start, length = int(it) - 1, int(items[k + 1])
                mapping.append((pos, start, length)); pos += length; k += 2; continue
            lit = re.fullmatch(r"(?:(\d+):)?(\d*)(X|C'[^']*'|Z)", it)
            if lit:
                if lit.group(1):
                    pos = int(lit.group(1)) - 1
                pos += int(lit.group(2) or 1) * (len(lit.group(3)) - 3 if lit.group(3).startswith("C'") else 1)
            k += 1
        # INREC first, then OUTREC on its result.
        segs = mapping if segs is None else [(o2, _through(segs, i2), l2) for o2, i2, l2 in mapping if _through(segs, i2) is not None]
    return segs


def _through(segs, off):
    for o, i, l in segs:
        if i <= off < i + l:
            return o + (off - i)
    return None


def moved(segs, s_off: int, size: int) -> int | None:
    """Where bytes [s_off, s_off + size) land after a reformat; None when the reformat drops them."""
    if segs is None:
        return s_off
    for o, i, l in segs:
        if i <= s_off and s_off + size <= i + l:
            return o + (s_off - i)
    return None


# ── The engine ─────────────────────────────────────────────────────────────────

class Lineage:
    def __init__(self, model: Model, root: Path):
        self.m = model
        self.root = root
        self._lay: dict[str, Layout] = {}
        self._ref: dict[tuple, Ref | None] = {}
        self.jobs = []
        for f in list_files(root, None):
            if role_of(f) == "jcl":
                try:
                    self.jobs.append(analyze_jcl(f, read_text(root / f)))
                except Exception:  # noqa: BLE001 — a JCL we can't read is reported by analyze, not here
                    pass
        self.cics_files = {}
        for part in model.map["parts"]:
            for st in part.get("stores", []):
                if st.get("kind") == "file" and st.get("dsn"):
                    self.cics_files.setdefault(base_dsn(st["dsn"]), set()).add(st["name"].upper())
        self.hops: list[dict] = []
        self.ops: list[dict] = []
        self.nodes: dict[str, dict] = {}
        self.notes: list[str] = []

    # storage
    def lay(self, prog: str) -> Layout:
        if prog not in self._lay:
            p = self.m.programs[prog]
            self._lay[prog] = Layout(p, self.m.index.view(p.path))
        return self._lay[prog]

    def ref(self, prog: str, name: str) -> Ref | None:
        key = (prog, name)
        if key in self._ref:
            return self._ref[key]
        lay = self.lay(prog)
        item = lay.find(name)
        out = None
        if item is not None:
            top = item
            for _ in range(12):
                parent = top.parent
                if not parent:
                    # A copybook's top item sits wherever the program copied it.
                    marker = next((x for x in self.m.programs[prog].items if x.copy and top.path != self.m.programs[prog].path
                                   and self.m.index.view(self.m.programs[prog].path).get(x.copy) is not None
                                   and self.m.index.view(self.m.programs[prog].path)[x.copy].path == top.path and x.parent), None)
                    if marker is None or top.level in (1, 77):
                        break
                    parent = marker.parent
                nxt = lay.find(parent)
                if nxt is None:
                    break
                top = nxt
            rootnode = lay.node(top)
            path = _path(rootnode, item)
            if path:
                n = path[-1]
                out = Ref(top.name, n.offset, n.total if not n.children else n.size * 1, item, n)
                if n.item.occurs:
                    out = Ref(top.name, n.offset, n.size, item, n)  # one occurrence of a table entry
            elif top is item:
                out = Ref(top.name, 0, rootnode.total, item, rootnode)
        self._ref[key] = out
        return out

    def field_at(self, prog: str, root: str, off: int, size: int) -> tuple[str | None, object]:
        """The field that is exactly these bytes, else the smallest that holds them."""
        lay = self.lay(prog)
        item = lay.find(root)
        if item is None:
            return None, None
        best = None

        def visit(n):
            nonlocal best
            if n.offset <= off and off + size <= n.offset + n.size and n.item.name != "FILLER":
                if best is None or n.size <= best.size:
                    best = n
            for c in n.children:
                visit(c)

        visit(lay.node(item))
        return (best.item.name, best.item) if best else (root, item)

    def node_info(self, sl: Slice) -> dict:
        if sl.key() in self.nodes:
            return self.nodes[sl.key()]
        if sl.where == "mem":
            name, item = self.field_at(sl.owner, sl.root, sl.off, sl.size)
            info = {"program": sl.owner, "record": sl.root, "field": name, "offset": sl.off, "size": sl.size, **{k: v for k, v in describe(item).items() if k in ("pic", "usage")}}
        elif sl.where == "db":
            info = {"column": sl.owner}
        else:
            info = {"dataset": sl.owner, "offset": sl.off, "size": sl.size}
        self.nodes[sl.key()] = info
        return info

    @staticmethod
    def overlaps(r: Ref | None, sl: Slice) -> bool:
        return r is not None and r.root == sl.root and r.off < sl.end and sl.off < r.off + r.size

    def hop(self, a: Slice, b: Slice, how: str, cite: dict, change: list[str] | None = None, **extra) -> None:
        self.node_info(a); self.node_info(b)
        self.hops.append({"from": a.key(), "to": b.key(), "how": how, **cite, "change": change or [], **extra})

    # the walk
    def trace(self, prog: str, field: str, depth: int = 14) -> dict:
        r = self.ref(prog, field)
        if r is None:
            return {"error": f"{field} isn't a field of {prog}"}
        start = Slice("mem", prog, r.root, r.off, r.size)
        self.node_info(start)
        origin = self.origin(prog, r)
        seen: set[str] = set()
        frontier = [(start, 0)]
        while frontier:
            sl, d = frontier.pop(0)
            if sl.key() in seen or d > depth:
                continue
            seen.add(sl.key())
            nxt = self.step_mem(sl) if sl.where == "mem" else self.step_ds(sl) if sl.where == "ds" else self.step_db(sl)
            frontier.extend((n, d + 1) for n in nxt)
        known = {(n["program"], n["field"]) for n in self.nodes.values() if "program" in n}
        similar = name_matches(self.m, field, describe(r.item), known | {(prog, field)})
        return {"element": {"program": prog, "field": field, **self.nodes[start.key()]}, "start": start.key(), "origin": origin,
                "nodes": self.nodes, "hops": self.hops, "operations": self.ops, "notes": self.notes, "same_name_elsewhere": similar}

    def step_mem(self, sl: Slice) -> list[Slice]:
        prog = sl.owner
        p = self.m.programs[prog]
        out: list[Slice] = []
        cite = lambda s: {"program": prog, "file": p.path, "line": s.line, "text": s.text(140)}
        when = lambda s: [g.render() for g in s.guards if business(g.text, g.kind)]
        flow = self.m.flow(prog)
        stmts = list(flow.statements())
        if sl.via == "return":
            # A buffer a call filled holds this element only until it is used or filled again: the statements after
            # the call in the same paragraph, up to the next one that overwrites it.
            arrival = flow.at(sl.at)
            stmts = sorted((x for x in stmts if arrival and x.para == arrival.para and x.line > sl.at), key=lambda x: x.line)
        for s in stmts:
            v = s.kind
            if sl.via == "return" and s.kind != "MOVE" and self._overwrites(prog, s, sl):
                break
            if v == "MOVE":
                sp = _split(s.tokens[1:], "TO")
                if not sp or not _names(sp[0]):
                    continue
                src = self.ref(prog, _names(sp[0])[0])
                if not self.overlaps(src, sl):
                    if any(self.overlaps(self.ref(prog, t), sl) for t in self._dst(sp[1])):
                        self.ops.append({"kind": "overwritten", **cite(s), "node": sl.key()})
                        if sl.via == "return":
                            break
                    continue
                for t in self._dst(sp[1]):
                    tr = self.ref(prog, t)
                    if tr is None:
                        continue
                    whole = src.off <= sl.off and sl.end <= src.off + src.size
                    elem_src = src.node is not None and not src.node.children
                    elem_dst = tr.node is not None and not tr.node.children
                    if whole and elem_src and elem_dst and (src.off, src.size) == (sl.off, sl.size):
                        b = Slice("mem", prog, tr.root, tr.off, tr.size)
                        how = "MOVE (value)"
                    elif whole:
                        off = tr.off + (sl.off - src.off)
                        if off >= tr.off + tr.size:
                            self.notes.append(f"{prog}:{s.line} MOVE {src.item.name} TO {t}: the element is past the end of {t}, so it is dropped")
                            continue
                        size = min(sl.size, tr.off + tr.size - off)
                        b = Slice("mem", prog, tr.root, off, size)
                        how = "MOVE (bytes)" + (" (cut short)" if size < sl.size else "")
                    else:
                        lo, hi = max(sl.off, src.off), min(sl.end, src.off + src.size)
                        off = tr.off + (lo - src.off)
                        if off >= tr.off + tr.size:
                            continue
                        b = Slice("mem", prog, tr.root, off, min(hi - lo, tr.off + tr.size - off))
                        how = "MOVE (part of the element)"
                    if b.key() == sl.key():
                        continue
                    a_item = self.field_at(prog, sl.root, sl.off, sl.size)[1]
                    b_item = self.field_at(prog, b.root, b.off, b.size)[1]
                    da, db = describe(a_item), describe(b_item)
                    if how.startswith("MOVE (bytes)") and (da.get("alpha") or da.get("group")) and not (db.get("alpha") or db.get("group")):
                        ch = [f"typed again as {db.get('pic')} (it was untyped bytes)"]  # a buffer or table entry read back as a field
                    elif how.startswith("MOVE (bytes)") and not (da.get("alpha") or da.get("group")) and (db.get("alpha") or db.get("group")):
                        ch = [f"carried as untyped bytes ({da.get('pic')} inside {db.get('pic') or 'a group'})"]
                    else:
                        ch = changes(da, db)
                    self.hop(sl, b, how, cite(s), ch, when=when(s), renamed=self.node_info(sl).get("field") != self.node_info(b).get("field"))
                    out.append(b)
            elif v in ("COMPUTE", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"):
                for st in s.sets:
                    srcs = [f for f in st["from"] if f != st["field"] and not f.startswith(("db2:", "cics:", "file:", "call:"))]
                    tr = self.ref(prog, st["field"])
                    if tr is None:
                        continue
                    if any(self.overlaps(self.ref(prog, f), sl) for f in srcs):
                        b = Slice("mem", prog, tr.root, tr.off, tr.size)
                        if b.key() == sl.key():
                            continue
                        a_item = self.field_at(prog, sl.root, sl.off, sl.size)[1]
                        ch = ["computed: " + s.text(160)]
                        words = [t.upper for t in s.tokens]
                        if "ROUNDED" not in words and v in ("COMPUTE", "DIVIDE", "MULTIPLY") and describe(tr.item).get("dec") is not None:
                            ch.append(f"no ROUNDED: the result is truncated to {describe(tr.item).get('dec', 0)} decimals")
                        ch += changes(describe(a_item), describe(tr.item))
                        self.hop(sl, b, f"{v} (derived)", cite(s), ch, when=when(s), renamed=True)
                        out.append(b)
                    elif self.overlaps(tr, sl) and not any(h["to"] == sl.key() and h["line"] == s.line for h in self.hops):
                        self.ops.append({"kind": "changed", **cite(s), "node": sl.key()})  # not the statement that made it
            elif v in ("IF", "EVALUATE", "LOOP"):
                if any(self.overlaps(self.ref(prog, n), sl) for n in _names(s.tokens) if n not in NOT_DATA):
                    self.ops.append({"kind": "decides", **cite(s), "node": sl.key(), "condition": _cond_text(s.tokens[1:])[:200]})
            elif v in ("WRITE", "REWRITE"):
                out += self._write(sl, s, cite(s))
            elif v == "CALL":
                out += self._call(sl, s, cite(s))
            elif v == "EXEC":
                out += self._exec(sl, s, cite(s))
        if sl.via not in ("return", "call-in"):
            out += self._returned(sl)
        return out

    def _overwrites(self, prog: str, s: Stmt, sl: Slice) -> bool:
        if s.kind == "CALL":
            sp = _split(s.tokens[1:], "USING")
            return bool(sp) and any(self.overlaps(self.ref(prog, a), sl) for a in _names(sp[1]))
        return any(self.overlaps(self.ref(prog, st["field"]), sl) for st in s.sets)

    @staticmethod
    def _dst(ts) -> list[str]:
        return _names(ts)[:1] if any(x.text == "(" for x in ts) else _targets(ts)

    # files
    def _write(self, sl: Slice, s: Stmt, cite: dict) -> list[Slice]:
        prog = sl.owner
        p = self.m.programs[prog]
        words = [t.upper for t in s.tokens]
        rec = words[1] if len(words) > 1 else None
        src = words[words.index("FROM") + 1] if "FROM" in words and words.index("FROM") + 1 < len(words) else rec
        r = self.ref(prog, src) if src else None
        if not self.overlaps(r, sl):
            return []
        off = sl.off - r.off
        file = p.fds.get(rec or "")
        sel = next((x for x in p.selects if x["file"] == file), None)
        if not sel:
            self.notes.append(f"{prog}:{s.line} {s.kind} {rec}: no SELECT found for its file")
            return []
        out = []
        for job, step, ds in self.dd_datasets(prog, sel["assign"]):
            b = Slice("ds", base_dsn(ds["dsn"]), "", off, sl.size)
            self.hop(sl, b, f"{s.kind} → DD {sel['assign']} → {ds['dsn']}", cite, [], job=job.path, job_line=ds["line"], step=step["step"])
            out.append(b)
        if not out:
            self.notes.append(f"{prog}:{s.line} writes DD {sel['assign']}, but no JCL step that runs {prog} names that DD")
        return out

    def runs(self, step: dict) -> str | None:
        return step.get("runs_program") or step.get("program")

    def callees(self, prog: str, depth: int = 3) -> list[str]:
        if prog not in self.m.programs:
            return []  # a utility or a program outside the repository
        out, todo = [prog], [prog]
        while todo and depth:
            nxt = []
            for q in todo:
                for c in (self.m.programs[q].calls if q in self.m.programs else []):
                    t = c.get("target")
                    if t and t in self.m.programs and t not in out:
                        out.append(t); nxt.append(t)
            todo, depth = nxt, depth - 1
        return out

    def dd_datasets(self, prog: str, dd: str):
        """(job, step, dataset) for each JCL step that runs prog (or a program that calls it) and names the DD."""
        for job in self.jobs:
            for step in job.steps:
                runner = self.runs(step)
                if not runner or (runner != prog and prog not in self.callees(runner)):
                    continue
                for ds in job.datasets:
                    if ds["step"] == step["step"] and ds["dd"] == dd:
                        yield job, step, ds

    def step_ds(self, sl: Slice) -> list[Slice]:
        """Everything that reads a dataset: utilities (and where they put it), programs, online CICS files."""
        out: list[Slice] = []
        for job in self.jobs:
            for step in job.steps:
                runner = self.runs(step)
                ins = [ds for ds in job.datasets if ds["step"] == step["step"] and base_dsn(ds["dsn"]) == sl.owner]
                if not ins or not runner:
                    continue
                cite = {"job": job.path, "file": job.path, "line": ins[0]["line"], "step": step["step"], "program": runner}
                control = "\n".join(t for lines in step.get("instream", {}).values() for _, t in lines)
                if runner in SORT_PROGRAMS:
                    if not any(ds["dd"] and ds["dd"].startswith("SORTIN") for ds in ins):
                        continue
                    segs = reformat(control)
                    new_off = moved(segs, sl.off, sl.size)
                    ctrl_line = next((ln for lines in step.get("instream", {}).values() for ln, t in lines if re.search(r"\b(OUT|IN)REC\b", t)), None)
                    for ds in job.datasets:
                        if ds["step"] == step["step"] and ds["dd"] == "SORTOUT":
                            if new_off is None:
                                self.notes.append(f"{job.path}:{ctrl_line} the sort's reformat drops bytes {sl.off}-{sl.end} of {sl.owner}")
                                continue
                            b = Slice("ds", base_dsn(ds["dsn"]), "", new_off, sl.size)
                            ch = [f"moved by the sort's reformat: offset {sl.off} → {new_off}"] if new_off != sl.off else []
                            self.hop(sl, b, f"SORT → {ds['dsn']}", {**cite, **({"line": ctrl_line} if ch and ctrl_line else {})}, ch, read_at=ins[0]["line"], written_at=ds["line"])
                            out.append(b)
                elif runner == "IDCAMS":
                    for m in re.finditer(r"REPRO\s+(.*)", control, re.I):
                        args = dict(re.findall(r"(INFILE|OUTFILE|INDATASET|OUTDATASET|IFILE|OFILE|IDS|ODS)\s*\(\s*([^)\s]+)\s*\)", m.group(1), re.I))
                        args = {k.upper(): v.upper() for k, v in args.items()}
                        in_dd, out_dd = args.get("INFILE") or args.get("IFILE"), args.get("OUTFILE") or args.get("OFILE")
                        in_ds, out_ds = args.get("INDATASET") or args.get("IDS"), args.get("OUTDATASET") or args.get("ODS")
                        if not ((in_dd and any(ds["dd"] == in_dd for ds in ins)) or (in_ds and base_dsn(in_ds) == sl.owner)):
                            continue
                        targets = [ds["dsn"] for ds in job.datasets if ds["step"] == step["step"] and ds["dd"] == out_dd] if out_dd else ([out_ds] if out_ds else [])
                        line = next((ln for lines in step.get("instream", {}).values() for ln, t in lines if "REPRO" in t.upper()), cite["line"])
                        for t in targets:
                            b = Slice("ds", base_dsn(t), "", sl.off, sl.size)
                            self.hop(sl, b, f"IDCAMS REPRO → {t}", {**cite, "line": line}, [])
                            out.append(b)
                elif runner in COPY_PROGRAMS:
                    if any(ds["dd"] == "SYSUT1" for ds in ins):
                        for ds in job.datasets:
                            if ds["step"] == step["step"] and ds["dd"] == "SYSUT2":
                                b = Slice("ds", base_dsn(ds["dsn"]), "", sl.off, sl.size)
                                self.hop(sl, b, f"{runner} → {ds['dsn']}", cite, [])
                                out.append(b)
                else:
                    for ds in ins:
                        out += self._program_reads(sl, runner, ds["dd"], {**cite, "line": ds["line"]})
        for name in self.cics_files.get(sl.owner, ()):
            out += self._cics_reads(sl, name)
        return out

    def _program_reads(self, sl: Slice, runner: str, dd: str, cite: dict) -> list[Slice]:
        out = []
        for prog in self.callees(runner):
            p = self.m.programs[prog]
            sel = next((x for x in p.selects if x["assign"] == dd), None)
            if not sel:
                continue
            for s in self.m.flow(prog).statements():
                words = [t.upper for t in s.tokens]
                if s.kind not in ("READ", "RETURN") or len(words) < 2 or words[1] != sel["file"]:
                    continue
                into = words[words.index("INTO") + 1] if "INTO" in words and words.index("INTO") + 1 < len(words) else None
                rec = next((r for r, f in p.fds.items() if f == sel["file"]), None)
                target = into or rec
                r = self.ref(prog, target) if target else None
                if r is None:
                    continue
                if sl.off >= r.size:
                    self.notes.append(f"{prog}:{s.line} READ {sel['file']} INTO {target}: the element (offset {sl.off}) is past the end of {target} ({r.size} bytes)")
                    continue
                b = Slice("mem", prog, r.root, r.off + sl.off, min(sl.size, r.size - sl.off), s.line, "read")
                self.hop(sl, b, f"DD {dd} → READ {sel['file']} INTO {target}", {"program": prog, "file": p.path, "line": s.line, "text": s.text(140), "job": cite.get("job"), "job_line": cite.get("line"), "step": cite.get("step")}, [])
                out.append(b)
        return out

    def _cics_reads(self, sl: Slice, name: str) -> list[Slice]:
        out = []
        for prog in self.m.programs:
            for s in self.m.flow(prog).statements():
                if s.kind != "EXEC" or len(s.tokens) < 3 or s.tokens[1].upper != "CICS" or s.tokens[2].upper != "READ":
                    continue
                text = " ".join(t.text for t in s.tokens).upper()
                f = re.search(r"\b(?:FILE|DATASET)\s*\(\s*'?([A-Z0-9#@$-]+)'?\s*\)", text)
                into = re.search(r"\bINTO\s*\(\s*([A-Z0-9-]+)", text)
                fname = f.group(1) if f else None
                if fname and fname != name:
                    # A file named through a variable: the value the program gives it.
                    vals = {v.get("value", "").upper() for e in self.m.edges if e["from"] == prog and e["cite"]["line"] == s.line for v in (e.get("dynamic") or {}).get("evidence", [])}
                    if name not in vals:
                        continue
                if not into:
                    continue
                r = self.ref(prog, into.group(1))
                if r is None or sl.off >= r.size:
                    continue
                b = Slice("mem", prog, r.root, r.off + sl.off, min(sl.size, r.size - sl.off))
                self.hop(sl, b, f"CICS READ FILE({name}) INTO {into.group(1)} (online)", {"program": prog, "file": self.m.programs[prog].path, "line": s.line, "text": s.text(140)}, [])
                out.append(b)
        return out

    def step_db(self, sl: Slice) -> list[Slice]:
        """Every program that reads the column into a host variable (SELECT … INTO, FETCH … INTO)."""
        out = []
        for reader in self.m.programs:
            for s2 in self.m.flow(reader).statements():
                for st in s2.sets:
                    if f"db2:{sl.owner}" in st["from"]:
                        r2 = self.ref(reader, st["field"])
                        if r2 is None:
                            continue
                        b = Slice("mem", reader, r2.root, r2.off, r2.size)
                        self.hop(sl, b, f"SQL {s2.tokens[2].upper if len(s2.tokens) > 2 else 'SELECT'} INTO {st['field']}", {"program": reader, "file": self.m.programs[reader].path, "line": s2.line, "text": s2.text(140)}, [])
                        out.append(b)
        return out

    # calls
    def using(self, prog: str) -> list[str]:
        ts = self.m.programs[prog].proc_tokens
        words = [t.upper for t in ts[:40]]
        if "USING" not in words:
            return []
        out = []
        for w in words[words.index("USING") + 1 :]:
            if w == ".":
                break
            if w not in ("BY", "REFERENCE", "VALUE", "CONTENT"):
                out.append(w)
        return out

    def _call(self, sl: Slice, s: Stmt, cite: dict) -> list[Slice]:
        prog = sl.owner
        words = [t for t in s.tokens]
        if len(words) < 2:
            return []
        target = words[1].text.strip("'\"").upper()
        sp = _split(s.tokens[1:], "USING")
        if target not in self.m.programs or not sp:
            return []
        args = _names(sp[1])
        params = self.using(target)
        out = []
        for k, a in enumerate(args):
            r = self.ref(prog, a)
            if not self.overlaps(r, sl) or k >= len(params):
                continue
            pr = self.ref(target, params[k])
            if pr is None:
                continue
            b = Slice("mem", target, pr.root, pr.off + (sl.off - r.off), sl.size, s.line, "call-in")
            self.hop(sl, b, f"CALL {target} USING (argument {k + 1})", cite, [])
            out.append(b)
        return out

    def _returned(self, sl: Slice) -> list[Slice]:
        """The element sits in one of this program's USING parameters: it goes back to every caller's argument."""
        prog = sl.owner
        params = self.using(prog)
        out = []
        # The callee put the element there under conditions on its parameters (EVALUATE LK-M03B-DD WHEN 'ACCTFILE'):
        # only the calls that pass those values get it back.
        arrival = self.m.flow(prog).at(sl.at) if sl.at else None
        need = self.conditions(prog, arrival) if arrival else []
        for k, prm in enumerate(params):
            pr = self.ref(prog, prm)
            if not self.overlaps(pr, sl):
                continue
            for caller in self.m.programs:
                for s in self.m.flow(caller).statements():
                    if s.kind != "CALL" or len(s.tokens) < 2 or s.tokens[1].text.strip("'\"").upper() != prog:
                        continue
                    sp = _split(s.tokens[1:], "USING")
                    args = _names(sp[1]) if sp else []
                    if k >= len(args):
                        continue
                    r = self.ref(caller, args[k])
                    if r is None or not self._passes(caller, s, r, pr, need, prog):
                        continue
                    b = Slice("mem", caller, r.root, r.off + (sl.off - pr.off), sl.size, s.line, "return")
                    self.hop(sl, b, f"returned to {caller} through CALL {prog} USING", {"program": caller, "file": self.m.programs[caller].path, "line": s.line, "text": s.text(140)}, [])
                    out.append(b)
        return out

    def literal_of(self, prog: str, name: str) -> tuple[str, str] | None:
        """A condition name (88) as the field it tests and the value it stands for."""
        item = self.lay(prog).find(name)
        if item is not None and item.level == 88 and item.parent and item.values:
            return item.parent, str(item.values[0]).strip("'\"")
        return None

    def conditions(self, prog: str, stmt: Stmt) -> list[tuple[str, str]]:
        """field = 'literal' conditions a statement runs under: its own guards and those of the PERFORMs that reach
        its paragraph (when every chain agrees), condition names included."""
        from .trace import Tracer

        def parse(texts):
            out = []
            for t in texts:
                if t.startswith("NOT ("):
                    continue
                out += re.findall(r"([A-Z0-9-]+) = '([^']*)'", t)
                if re.fullmatch(r"[A-Z0-9-]+", t.strip()):
                    lit = self.literal_of(prog, t.strip())
                    if lit:
                        out.append(lit)
            return out

        own = parse([g.render() for g in stmt.guards])
        flow = self.m.flow(prog)
        chains = Tracer(self.m).reached_from(flow, stmt.para) if stmt.para else []
        sets = [set(parse([w for step in chain for w in step.get("when", [])])) for chain in chains if chain]
        common = set.intersection(*sets) if sets else set()
        return own + sorted(common)

    def _passes(self, caller: str, call: Stmt, arg: Ref, param: Ref, need: list, callee: str) -> bool:
        """Whether the values the caller puts in the argument before this call meet the callee's conditions.
        Unknown values pass: only a literal that contradicts the condition rules a call out."""
        flow = self.m.flow(caller)
        for f, lit in need:
            pf = self.ref(callee, f)
            if pf is None or pf.root != param.root:
                continue
            want_off = arg.off + (pf.off - param.off)
            last = None
            for s in flow.statements():
                if s.para != call.para or s.line >= call.line or s.kind not in ("MOVE", "SET"):
                    continue
                sp = _split(s.tokens[1:], "TO")
                if not sp or not sp[0] or not sp[1]:
                    continue
                if s.kind == "SET":
                    # SET M03B-READ TO TRUE: the field behind the condition name takes its value.
                    cn = self.literal_of(caller, sp[0][0].upper) if sp[1][0].upper == "TRUE" else None
                    if not cn:
                        continue
                    targets, value = [cn[0]], cn[1]
                elif sp[0][0].kind == "literal":
                    targets, value = self._dst(sp[1]), sp[0][0].text.strip("'\"")
                else:
                    continue
                for t in targets:
                    tr = self.ref(caller, t)
                    if tr is not None and tr.root == arg.root and tr.off == want_off:
                        if last is None or s.line > last[0]:
                            last = (s.line, value)
            if last is not None and last[1].rstrip() != lit.rstrip():
                return False
        return True

    def _exec(self, sl: Slice, s: Stmt, cite: dict) -> list[Slice]:
        prog = sl.owner
        if len(s.tokens) < 3:
            return []
        text = " ".join(t.text for t in s.tokens).upper()
        out = []
        if s.tokens[1].upper == "CICS" and s.tokens[2].upper in ("LINK", "XCTL"):
            m = re.search(r"COMMAREA\s*\(\s*([A-Z0-9-]+)", text)
            r = self.ref(prog, m.group(1)) if m else None
            if not self.overlaps(r, sl):
                return []
            for e in self.m.edges:
                if e["from"] != prog or e["cite"]["line"] != s.line or e["kind"] not in ("links", "transfers"):
                    continue
                for callee in ((e.get("dynamic") or {}).get("resolved") or [e["to"]]):
                    if callee not in self.m.programs:
                        continue
                    cr = self.ref(callee, "DFHCOMMAREA")
                    if cr is None:
                        continue
                    b = Slice("mem", callee, cr.root, cr.off + (sl.off - r.off), sl.size)
                    self.hop(sl, b, f"CICS {s.tokens[2].upper} {callee} COMMAREA", cite, [])
                    out.append(b)
        elif s.tokens[1].upper == "SQL":
            for table, col, host in sql_writes(text):
                r = self.ref(prog, host)
                if not self.overlaps(r, sl):
                    continue
                b = Slice("db", f"{table}.{col}", "", 0, 0)
                verb = "INSERT" if re.search(r"INSERT", text) else "UPDATE"
                self.hop(sl, b, f"SQL {verb} {table}.{col}", cite, [])
                out.append(b)
        return out

    # where the element came from
    def origin(self, prog: str, r: Ref) -> list[dict]:
        """The statements that fill the element's record from a file, and the jobs and steps that made that file."""
        p = self.m.programs[prog]
        out = []
        for s in self.m.flow(prog).statements():
            words = [t.upper for t in s.tokens]
            if s.kind == "READ" and "INTO" in words and words.index("INTO") + 1 < len(words):
                into = self.ref(prog, words[words.index("INTO") + 1])
                if into is None or into.root != r.root:
                    continue
                file = words[1]
                sel = next((x for x in p.selects if x["file"] == file), None)
                entry = {"program": prog, "file": p.path, "line": s.line, "text": s.text(140), "datasets": []}
                if sel:
                    for job, step, ds in self.dd_datasets(prog, sel["assign"]):
                        entry["datasets"].append({"job": job.path, "line": ds["line"], "dd": ds["dd"], "dsn": ds["dsn"], "made_by": self.writers(base_dsn(ds["dsn"]))})
                out.append(entry)
        return out

    def writers(self, dsn: str, depth: int = 2) -> list[dict]:
        out = []
        for job in self.jobs:
            for step in job.steps:
                runner = self.runs(step)
                control = "\n".join(t for lines in step.get("instream", {}).values() for _, t in lines)
                for ds in job.datasets:
                    if ds["step"] != step["step"] or base_dsn(ds["dsn"]) != dsn:
                        continue
                    if runner == "IDCAMS":
                        m = re.search(r"REPRO\s+INFILE\s*\(\s*(\S+?)\s*\)\s+OUTFILE\s*\(\s*(\S+?)\s*\)", control, re.I)
                        if m and m.group(2).upper() == ds["dd"]:
                            src = [d["dsn"] for d in job.datasets if d["step"] == step["step"] and d["dd"] == m.group(1).upper()]
                            line = next((ln for lines in step.get("instream", {}).values() for ln, t in lines if "REPRO" in t.upper()), ds["line"])
                            out.append({"job": job.path, "line": line, "how": "IDCAMS REPRO", "from": src})
                    elif runner in SORT_PROGRAMS and ds["dd"] == "SORTOUT":
                        out.append({"job": job.path, "line": ds["line"], "how": "SORT", "from": [d["dsn"] for d in job.datasets if d["step"] == step["step"] and (d["dd"] or "").startswith("SORTIN")]})
                    elif ds["disp"] in ("NEW", "MOD") and runner:
                        out.append({"job": job.path, "line": ds["line"], "how": f"written by {runner}", "from": []})
        return out


# ── Elements linked only by name (B3): candidates for the model to propose, a person to confirm ─────────────

WORDS = {"INT": "INTEREST", "INTR": "INTEREST", "AMT": "AMOUNT", "BAL": "BALANCE", "RT": "RATE", "CUST": "CUSTOMER", "ACCT": "ACCOUNT",
         "ACC": "ACCOUNT", "NUM": "NUMBER", "NBR": "NUMBER", "NO": "NUMBER", "DT": "DATE", "CD": "CODE", "TRAN": "TRANSACTION",
         "TRN": "TRANSACTION", "TRNX": "TRANSACTION", "TXN": "TRANSACTION", "CR": "CREDIT", "DR": "DEBIT", "LMT": "LIMIT", "PCT": "PERCENT",
         "QTY": "QUANTITY", "ADDR": "ADDRESS", "ID": "IDENTIFIER", "YR": "YEAR", "MO": "MONTH", "CURR": "CURRENT", "AVAIL": "AVAILABLE", "AV": "AVAILABLE"}
NOISE = {"WS", "HV", "LK", "FD", "COMM", "DIS", "OUT", "IN", "ARR", "VB1", "VB2", "ST", "SUBPGM", "DFH", "DB2", "SQL", "W", "X", "I", "O", "OF", "THE"}


def concepts(name: str) -> frozenset:
    """A data name as the business words it abbreviates: DIS-INT-RATE, INTEREST-RATE and I-RATE all say interest rate
    (single letters are kept as initials)."""
    out = []
    for w in re.split(r"[-_]", name.upper()):
        if not w or w in NOISE and len(w) > 1 or w.isdigit():
            continue
        out.append(WORDS.get(w, w))
    return frozenset(out)


def name_matches(m: Model, field: str, pic: dict, known: set[tuple[str, str]], limit: int = 25) -> list[dict]:
    """Fields anywhere in the estate whose names say the same business words (an initial can stand for a word) with a
    compatible picture, that the lineage didn't reach through the code."""
    want = concepts(field)
    if not want:
        return []
    out, seen = [], set()
    sources = list(m.programs.items()) + [(f"copybook {n}", cp) for n, cps in m.index.by_name.items() for cp in cps]
    for name, prog in sources:
        for item in prog.items:
            if not item.pic or item.name in ("FILLER",) or (name, item.name) in known or (item.path, item.name) in seen:
                continue
            if name.startswith("copybook ") and item.name in {f for _, f in known}:
                continue  # the copybook's own declaration of a field the lineage already reached
            got = concepts(item.name)
            if not got:
                continue
            full = [w for w in got if len(w) > 1]
            initials = [w for w in got if len(w) == 1]
            # every word matched, an initial matching the first letter of a word still missing
            missing = [w for w in want if w not in full]
            if any(w not in want for w in full) or len(missing) != len(initials) or sorted(w[0] for w in missing) != sorted(initials):
                continue
            d = describe(item)
            if pic.get("alpha") != d.get("alpha"):
                continue
            seen.add((item.path, item.name))
            out.append({"program": name, "field": item.name, "pic": item.pic, "file": item.path, "line": item.line,
                        "same_picture": (d.get("int"), d.get("dec"), d.get("signed")) == (pic.get("int"), pic.get("dec"), pic.get("signed")),
                        "status": "candidate: no path through the code; identity to be proposed by the model and confirmed by a person"})
            if len(out) >= limit:
                return out
    return out


def sql_writes(text: str) -> list[tuple[str, str, str]]:
    """(table, column, host variable) for INSERT … (cols) VALUES (:h, …) and UPDATE … SET col = :h."""
    out = []
    m = re.search(r"INSERT\s+INTO\s+([A-Z0-9_.]+)\s*\(([^)]*)\)\s*VALUES\s*\((.*?)\)\s*(?:END-EXEC|$)", text, re.S)
    if m:
        table = m.group(1).split(".")[-1]
        cols = [c.strip() for c in m.group(2).split(",")]
        vals = [v.strip() for v in m.group(3).split(",")]
        for c, v in zip(cols, vals):
            h = re.match(r":\s*([A-Z0-9-]+)", v)
            if h:
                out.append((table, c, h.group(1)))
    m = re.search(r"UPDATE\s+([A-Z0-9_.]+)\s+SET\s+(.*?)(?:\bWHERE\b|END-EXEC|$)", text, re.S)
    if m:
        table = m.group(1).split(".")[-1]
        for c, h in re.findall(r"([A-Z0-9_]+)\s*=\s*:\s*([A-Z0-9-]+)", m.group(2)):
            out.append((table, c, h))
    return out


# ── Rendering ────────────────────────────────────────────────────────────────

def render(t: dict) -> str:
    if "error" in t:
        return t["error"]
    nodes = t["nodes"]
    def label(k):
        n = nodes[k]
        if "program" in n:
            return f"{n['program']}.{n['field']}" + (f" {n['pic']}" if n.get("pic") else "")
        if "column" in n:
            return f"DB2 column {n['column']}"
        return f"dataset {n['dataset']} (bytes {n['offset'] + 1}-{n['offset'] + n['size']})"
    e = t["element"]
    lines = [f"{e['program']}.{e['field']} {e.get('pic') or ''}"]
    for o in t["origin"]:
        lines.append(f"  comes from {o['text']}  ({o['file']}:{o['line']})")
        for d in o["datasets"]:
            lines.append(f"    DD {d['dd']} = {d['dsn']}  ({d['job']}:{d['line']})")
            for w in d["made_by"]:
                lines.append(f"      made by {w['how']} from {', '.join(w['from']) or '?'}  ({w['job']}:{w['line']})")
    by_from: dict[str, list] = {}
    for h in t["hops"]:
        by_from.setdefault(h["from"], []).append(h)
    shown: set = set()

    def walk(k, indent):
        for h in by_from.get(k, []):
            mark = (h["from"], h["to"], h["line"])
            if mark in shown:
                continue
            shown.add(mark)
            where = f"{h['file'].rsplit('/', 1)[-1]}:{h['line']}"
            ch = f"  [{'; '.join(h['change'])}]" if h["change"] else ""
            lines.append(f"{'  ' * indent}→ {label(h['to'])}  via {h['how']}  ({where}){ch}")
            if indent < 40:
                walk(h["to"], indent + 1)

    walk(t["start"], 1)
    ops = [o for o in t["operations"] if o["kind"] in ("decides", "changed")]
    if ops:
        lines.append("\nOperations on it:")
        for o in ops:
            lines.append(f"  {o['kind']:<8} {o['program']}:{o['line']}  {o['text'][:110]}")
    if t.get("same_name_elsewhere"):
        lines.append("\nSame business name, no path through the code (for the model to propose, a person to confirm):")
        for c in t["same_name_elsewhere"]:
            lines.append(f"  {c['program']}.{c['field']} {c['pic']}  ({c['file']}:{c['line']}){'' if c['same_picture'] else '  [different picture]'}")
    if t["notes"]:
        lines.append("\nNotes:")
        lines += [f"  {n}" for n in t["notes"]]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    root = Path(argv[0])
    prog, field = argv[1].upper(), argv[2].upper()
    depth = int(argv[argv.index("--depth") + 1]) if "--depth" in argv else 14
    t = Lineage(Model(root), root).trace(prog, field, depth)
    sys.stdout.reconfigure(encoding="utf-8")
    print(render(t))
    if "--json" in argv:
        Path(argv[argv.index("--json") + 1]).write_text(json.dumps(t, indent=1, default=str), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
