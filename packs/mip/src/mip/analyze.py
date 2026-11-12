"""
MIP analyze (P1, L2): a mainframe repository in, the platform's code map out
(packages/domain/src/code-map.ts: one CodeMapPart per technology), every node and edge
cited to the file and line it came from, plus diagnostics for what couldn't be read.

    python -m mip analyze <root> [--files list.txt] [--out map.json]

Only reads files. Never runs anything from the repository.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

from . import __version__
from .cobol import Program, analyze as analyze_cobol, string_values
from .embedded import DLI_READS, DLI_WRITES, cics_facts, dli_call_facts, dli_exec_facts, sql_facts
from .interfaces import check as check_interface
from .layout import Layout, table_values
from .jcl import analyze_bms, analyze_csd, analyze_jcl
from .source import read_text

LEVEL = 2  # P2 adds resolution (tables, constant evaluation) and interface checks on top of L2 structure
ROLE = [
    ("program", r"\.(cbl|cob)$"),
    ("copybook", r"\.(cpy|copy)$"),
    ("jcl", r"\.(jcl|prc|proc)$|\.jcl\.j2$|/jcl/.*\.j2$"),
    ("csd", r"\.csd$"),
    ("bms", r"\.bms$"),
]


def role_of(path: str) -> str | None:
    for role, rx in ROLE:
        if re.search(rx, path, re.I):
            return role
    return None


def list_files(root: Path, files_list: Path | None) -> list[str]:
    if files_list:
        return [l.strip().replace("\\", "/") for l in files_list.read_text(encoding="utf-8").splitlines() if l.strip()]
    try:
        return subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True).stdout.splitlines()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()]


def cite(path: str, line: int) -> dict:
    return {"file": path, "line": line}


class CopybookIndex:
    """Copybooks by name, possibly several per name (Bank of Z has two XFRFUN.cpy). Like a compiler's library
    search order, each program sees the one nearest its own folder; duplicates are reported."""

    def __init__(self) -> None:
        self.by_name: dict[str, list[Program]] = {}
        self._views: dict[str, dict[str, Program]] = {}

    def add(self, name: str, cp: Program) -> None:
        self.by_name.setdefault(name, []).append(cp)

    def all(self) -> list[Program]:
        return [cp for cps in self.by_name.values() for cp in cps]

    @staticmethod
    def _near(a: str, b: str) -> int:
        pa, pb = a.split("/")[:-1], b.split("/")[:-1]
        n = 0
        while n < min(len(pa), len(pb)) and pa[n] == pb[n]:
            n += 1
        return n

    def view(self, path: str) -> dict[str, Program]:
        folder = path.rsplit("/", 1)[0]
        if folder not in self._views:
            self._views[folder] = {name: max(cps, key=lambda cp: (self._near(cp.path, path), -len(cp.path))) for name, cps in self.by_name.items()}
        return self._views[folder]

    def duplicates(self) -> dict[str, list[str]]:
        return {name: [cp.path for cp in cps] for name, cps in self.by_name.items() if len(cps) > 1}


class Builder:
    """Collects units, entries, stores and edges per technology part."""

    def __init__(self) -> None:
        self.parts: dict[str, dict] = {}
        self.diagnostics: list[dict] = []

    def part(self, tech: str) -> dict:
        return self.parts.setdefault(tech, {"technology": {"id": tech, "level": LEVEL}, "units": [], "entries": [], "stores": {}, "edges": []})

    def unit(self, tech, id, kind, name, path, line, parent=None):
        u = {"id": id, "kind": kind, "name": name, "tech": tech, "cite": cite(path, line)}
        if parent:
            u["parent"] = parent
        self.part(tech)["units"].append(u)

    def store(self, tech, kind, name, path=None, line=None, **extra):
        sid = f"{kind}:{name}"
        st = self.part(tech)["stores"]
        if sid not in st:
            st[sid] = {"id": sid, "kind": kind, "name": name, **({"cite": cite(path, line)} if path else {}), **extra}
        return sid

    def edge(self, tech, frm, to, kind, path, line, **extra):
        self.part(tech)["edges"].append({"from": frm, "to": to, "kind": kind, "cite": cite(path, line), **{k: v for k, v in extra.items() if v is not None}})

    def result(self) -> list[dict]:
        out = []
        for p in self.parts.values():
            out.append({**p, "stores": list(p["stores"].values())})
        return out


def analyze_repo(root: Path, files_list: Path | None = None, keep: dict | None = None) -> dict:
    """The code map. `keep`, when given, receives the analysis itself (programs, copybook index) for trace.py."""
    t0 = time.perf_counter()
    files = list_files(root, files_list)
    by_role: dict[str, list[str]] = {}
    for f in files:
        r = role_of(f)
        if r:
            by_role.setdefault(r, []).append(f)

    b = Builder()
    index = CopybookIndex()
    for path in by_role.get("copybook", []):
        try:
            cp = analyze_cobol(path, read_text(root / path), kind="copybook")
            stem = re.sub(r"\.[^.]+$", "", path.rsplit("/", 1)[-1]).upper()
            cp.name = stem
            index.add(stem, cp)
            if len(index.by_name[stem]) == 1:
                b.unit("cobol", f"CPY:{stem}", "copybook", stem, path, 1)
        except Exception as err:  # noqa: BLE001
            b.diagnostics.append({"file": path, "error": f"{type(err).__name__}: {err}"})
    for name, paths in index.duplicates().items():
        b.diagnostics.append({"warning": f"{len(paths)} copybooks named {name}: each program uses the one nearest its own folder", "files": paths})

    programs: dict[str, Program] = {}
    for path in by_role.get("program", []):
        try:
            prog = analyze_cobol(path, read_text(root / path), copybooks=index.view(path))
        except Exception as err:  # noqa: BLE001
            b.diagnostics.append({"file": path, "error": f"{type(err).__name__}: {err}"})
            continue
        if prog.name in programs:
            b.diagnostics.append({"file": path, "warning": f"PROGRAM-ID {prog.name} also in {programs[prog.name].path}"})
        programs.setdefault(prog.name, prog)
        _emit_program(b, prog, index.view(path))

    for cp in index.all():
        if (cp.performs or cp.calls or cp.execs) and cp is index.by_name[cp.name][0]:
            _emit_program(b, cp, index.view(cp.path), unit_id=f"CPY:{cp.name}")

    # Interfaces (P2): every LINK/XCTL with a COMMAREA to a program in the repository, byte for byte.
    interfaces = []
    for e in b.part("cics")["edges"] if "cics" in b.parts else []:
        if e["kind"] not in ("links", "transfers") or not e.get("commarea") or e["from"] not in programs:
            continue
        targets = [e["to"]] if e["to"] in programs else [t for t in (e.get("dynamic") or {}).get("resolved", []) if t in programs]
        for t in dict.fromkeys(targets):
            r = check_interface(programs[e["from"]], {**e, "to": t}, programs, index.view)
            if r:
                interfaces.append(r)
    if interfaces:
        b.part("cics")["interfaces"] = interfaces

    jobs = []
    for path in by_role.get("jcl", []):
        try:
            job = analyze_jcl(path, read_text(root / path))
        except Exception as err:  # noqa: BLE001
            b.diagnostics.append({"file": path, "error": f"{type(err).__name__}: {err}"})
            continue
        jobs.append(job)
        _emit_job(b, job)

    for path in by_role.get("csd", []):
        for d in analyze_csd(path, read_text(root / path)):
            if d["define"] == "TRANSACTION" and d.get("program"):
                b.part("cics")["entries"].append({"id": f"TX:{d['name']}", "kind": "transaction", "name": d["name"], "unit": d["program"], "cite": cite(path, d["line"])})
            elif d["define"] == "FILE":
                b.store("cics", "file", d["name"], path, d["line"], **({"dsn": d["dsname"]} if d.get("dsname") else {}))

    for path in by_role.get("bms", []):
        for m in analyze_bms(path, read_text(root / path)):
            if m["kind"] == "mapset":
                b.unit("cics", f"MAP:{m['name']}", "screen", m["name"], path, m["line"])

    if keep is not None:
        keep.update(programs=programs, index=index)
    return {
        "mip": __version__,
        "level": LEVEL,
        "root": str(root),
        "files": {k: len(v) for k, v in by_role.items()},
        "seconds": round(time.perf_counter() - t0, 2),
        "parts": b.result(),
        "findings": [
            {"kind": "interface_drift", **i} for i in (b.parts.get("cics", {}).get("interfaces") or []) if i.get("verdict") == "differs"
        ],
        "diagnostics": b.diagnostics,
        "facts": {
            name: {
                "path": p.path,
                "paragraphs": len(p.paragraphs),
                "data_items": len(p.data),
                "redefines": sum(1 for d in p.data.values() if d.redefines),
                "occurs": sum(1 for d in p.data.values() if d.occurs),
                "selects": p.selects,
                "strings": p.strings,
            }
            for name, p in programs.items()
        },
    }


def _copied(prog: Program, copybooks: dict[str, Program]) -> list[Program]:
    return [copybooks[c["copybook"]] for c in prog.copies if c["copybook"] in copybooks]


def _emit_program(b: Builder, prog: Program, copybooks: dict[str, Program], unit_id: str | None = None) -> None:
    pid = unit_id or prog.name
    path = prog.path
    copied = _copied(prog, copybooks)
    if unit_id is None:
        b.unit("cobol", pid, "program", prog.name, path, 1)
        for para in prog.paragraphs:
            b.unit("cobol", f"{pid}.{para['name']}", "paragraph", para["name"], path, para["line"], parent=pid)
        for c in prog.copies:
            b.edge("cobol", pid, f"CPY:{c['copybook']}", "includes", path, c["line"], replacing=c.get("replacing"))
    scope = lambda s: f"{pid}.{s}" if s else None  # noqa: E731
    for p in prog.performs:
        b.edge("cobol", pid, f"{pid}.{p['target']}", "performs", path, p["line"], scope=scope(p["scope"]), thru=(f"{pid}.{p['thru']}" if p.get("thru") else None))
    for g in prog.gotos:
        b.edge("cobol", pid, f"{pid}.{g['target']}", "performs", path, g["line"], scope=scope(g["scope"]), go_to=True)
    for c in prog.calls:
        if c.get("dynamic"):
            from .cobol import literal_values

            item = prog.data.get(c["via"]) or next((cp.data[c["via"]] for cp in copied if c["via"] in cp.data), None)
            pointer = item is not None and item.usage in ("PROCEDURE-POINTER", "FUNCTION-POINTER", "POINTER")
            values = [] if pointer else literal_values(prog, c["via"], copied)
            b.edge("cobol", pid, c["via"], "calls", path, c["line"], scope=scope(c["scope"]), dynamic={"via": c["via"], "resolved": [v["value"] for v in values], "evidence": values}, pointer=True if pointer else None)
        else:
            b.edge("cobol", pid, c["target"], "calls", path, c["line"], scope=scope(c["scope"]))
            if c["target"] in ("CBLTDLI", "AIBTDLI", "CEETDLI", "PLITDLI"):
                f = dli_call_facts(prog, c, copied)
                _emit_dli(b, pid, path, f, scope(c["scope"]))
    for io in prog.file_io:
        kind = {"READ": "reads", "START": "reads", "WRITE": "writes", "REWRITE": "updates", "DELETE": "deletes", "OPEN": None}[io["verb"]]
        if not kind:
            continue
        sel = next((s for s in prog.selects if s["file"] == io["file"]), None)
        sid = b.store("cobol", "file", io["file"], path, sel["line"] if sel else io["line"], **({k: sel[k] for k in ("assign", "organization", "access", "record_key") if k in sel} if sel else {}))
        b.edge("cobol", pid, sid, kind, path, io["line"], scope=scope(io["scope"]))
    cursors: dict[str, list[str]] = {}
    for blk in prog.execs:
        if blk.kind == "SQL":
            f = sql_facts(blk)
            if f.get("declares") == "CURSOR":
                cursors[f["name"]] = f.get("tables", [])
    for blk in prog.execs:
        if blk.unterminated:
            b.diagnostics.append({"file": path, "line": blk.line, "warning": f"EXEC {blk.kind} without END-EXEC before the next EXEC (code past column 72?)"})
        if blk.kind == "CICS":
            _emit_cics(b, pid, path, _resolve(prog, copybooks, copied, cics_facts(prog, blk, copied)))
        elif blk.kind == "SQL":
            f = sql_facts(blk)
            verb = f["verb"]
            tables = f.get("tables") or cursors.get(f.get("cursor", ""), [])
            kind = {"SELECT": "reads", "FETCH": "reads", "INSERT": "writes", "UPDATE": "updates", "DELETE": "deletes", "MERGE": "updates"}.get(verb)
            if f.get("declares") == "CURSOR":
                kind = "reads"
            if kind:
                for t in tables:
                    b.edge("db2", pid, b.store("db2", "table", t), kind, path, f["line"], sql=verb, **({"cursor": f.get("cursor") or f.get("name")} if f.get("cursor") or f.get("declares") == "CURSOR" else {}))
            if verb == "INCLUDE" and f.get("include") not in (None, "SQLCA", "SQLDA"):
                b.edge("db2", pid, f"CPY:{f['include']}", "includes", path, f["line"], sql_include=True)
            b.part("db2").setdefault("statements", []).append({"program": pid, **{k: v for k, v in f.items() if k != "end"}, "tables": tables})
        elif blk.kind == "DLI":
            _emit_dli(b, pid, path, dli_exec_facts(blk), None)


def _resolve(prog: Program, copybooks: dict[str, Program], copied: list[Program], f: dict) -> dict:
    """A data-held target with no literal: try a table read the way the program reads it, then a STRING built from known parts."""
    for key in ("program", "transid", "file", "dataset", "queue"):
        if f.get(f"{key}_dynamic") and not f.get(f"{key}_values"):
            vals = table_values(Layout(prog, copybooks), f[key])
            if not vals:
                vals = [{**v, "file": prog.path} for v in string_values(prog, f[key], f["line"], copied)]
            seen = set()
            f[f"{key}_values"] = [v for v in vals if not (v["value"] in seen or seen.add(v["value"]))]
    return f


def _emit_dli(b: Builder, pid: str, path: str, f: dict, scope: str | None) -> None:
    fn = (f.get("function") or "").strip().upper()
    kind = "reads" if fn in DLI_READS else DLI_WRITES.get(fn)
    segs = f.get("segments") or ([f["segment"]] if f.get("segment") else [])
    b.part("ims").setdefault("calls", []).append({"program": pid, **f})
    if not kind:
        return
    for s in segs or ["?"]:
        b.edge("ims", pid, b.store("ims", "table", f"IMS:{s}"), kind, path, f["line"], dli=fn, interface=f.get("interface"), pcb=f.get("pcb"), scope=scope)


def _emit_cics(b: Builder, pid: str, path: str, f: dict) -> None:
    cmd = f["command"]
    line = f["line"]
    verb = cmd.split()[0]

    def dyn(key):
        if f.get(f"{key}_dynamic"):
            vals = f.get(f"{key}_values", [])
            return {"via": f[key], "resolved": [v["value"] for v in vals], "evidence": vals}
        return None

    if verb in ("LINK", "XCTL") and f.get("program"):
        d = dyn("program")
        to = d["resolved"][0] if d and len(d["resolved"]) == 1 else f["program"]
        b.edge("cics", pid, to, "links" if verb == "LINK" else "transfers", path, line, command=verb, dynamic=d, commarea=f.get("commarea"), channel=f.get("channel"))
    elif verb in ("RETURN", "START", "RUN") and f.get("transid"):
        d = dyn("transid")
        b.edge("cics", pid, f"TX:{f['transid']}" if not d else f["transid"], "starts", path, line, command=cmd, dynamic=d, asynchronous=True if verb == "RUN" else None)
    elif verb in ("READ", "READNEXT", "READPREV", "STARTBR", "WRITE", "REWRITE", "DELETE") and (f.get("file") or f.get("dataset")):
        name = f.get("file") or f.get("dataset")
        key = "file" if f.get("file") else "dataset"
        d = dyn(key)
        kind = {"WRITE": "writes", "REWRITE": "updates", "DELETE": "deletes"}.get(verb, "reads")
        target = b.store("cics", "file", d["resolved"][0] if d and len(d["resolved"]) == 1 else name)
        b.edge("cics", pid, target, kind, path, line, command=verb, dynamic=d)
    elif cmd in ("SEND MAP", "RECEIVE MAP") and (f.get("mapset") or f.get("map")):
        b.edge("cics", pid, f"MAP:{f.get('mapset') or f.get('map')}", "shows", path, line, command=cmd, map=f.get("map"))
    elif verb in ("WRITEQ", "READQ", "DELETEQ") and f.get("queue"):
        b.edge("cics", pid, b.store("cics", "queue", f["queue"]), "writes" if verb == "WRITEQ" else ("reads" if verb == "READQ" else "deletes"), path, line, command=cmd)
    b.part("cics").setdefault("commands", []).append({"program": pid, **{k: v for k, v in f.items() if k != "end"}})


def _emit_job(b: Builder, job) -> None:
    jid = f"JOB:{job.name or Path(job.path).stem.upper()}"
    b.unit("jcl", jid, "job", job.name or Path(job.path).stem.upper(), job.path, job.line or 1)
    prev = None
    for s in job.steps:
        sid = f"{jid}.{s['step'] or s['line']}"
        b.unit("jcl", sid, "step", s["step"] or f"line {s['line']}", job.path, s["line"], parent=jid)
        b.part("jcl")["entries"].append({"id": f"ENTRY:{sid}", "kind": "job_step", "name": f"{job.name} {s['step'] or ''}".strip(), "unit": sid, "cite": cite(job.path, s["line"])})
        if s.get("program"):
            b.edge("jcl", sid, s["program"], "runs", job.path, s["line"], utility=True if s["program"] in ("IKJEFT01", "IKJEFT1B", "IEFBR14", "IDCAMS", "SORT", "IEBGENER", "DFSRRC00", "DSNTEP2") else None)
        if s.get("proc"):
            b.edge("jcl", sid, f"PROC:{s['proc']}", "runs", job.path, s["line"], proc=True)
        if s.get("runs_program"):
            b.edge("jcl", sid, s["runs_program"], "runs", job.path, s["runs_line"], via=s["via"])
        if prev:
            b.edge("jcl", prev, sid, "next", job.path, s["line"])
        prev = sid
    for d in job.datasets:
        kind = "reads" if d["disp"] in ("SHR", "OLD") else ("writes" if d["disp"] in ("NEW", "MOD") else "reads")
        frm = f"{jid}.{d['step']}" if d["step"] else jid
        b.edge("jcl", frm, b.store("jcl", "dataset", d["dsn"]), kind, job.path, d["line"], dd=d["dd"], disp=d["disp"])


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] != "analyze":
        print("usage: python -m mip analyze <root> [--files list.txt] [--out map.json]", file=sys.stderr)
        return 2
    root = Path(argv[1])
    files_list = Path(argv[argv.index("--files") + 1]) if "--files" in argv else None
    result = analyze_repo(root, files_list)
    text = json.dumps(result, indent=1, ensure_ascii=False)
    if "--out" in argv:
        Path(argv[argv.index("--out") + 1]).write_text(text, encoding="utf-8")
        edges = sum(len(p["edges"]) for p in result["parts"])
        print(f"mip {result['mip']}: {result['files']} · {edges} edges · {len(result['diagnostics'])} diagnostics · {result['seconds']}s", file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0
