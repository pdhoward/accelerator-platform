"""
JCL, CICS resource definitions (CSD) and BMS maps (L2): the batch and online wiring that
lives outside the programs. JCL: jobs, steps, the program or procedure each step runs
(including programs run through TSO batch: IKJEFT01 → DSN RUN PROGRAM(x) in SYSTSIN),
datasets and their dispositions, in-stream PROCs. CSD: which program a transaction runs,
which dataset a CICS file is. BMS: the mapsets and maps a program can send.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Statement:
    line: int
    name: str | None
    op: str
    operands: str


def _parameters(operands: str) -> dict[str, str]:
    """KEY=VALUE pairs at the top level (commas inside parentheses and quotes don't split)."""
    out, depth, cur, q = {}, 0, "", False
    parts = []
    for c in operands:
        if c == "'":
            q = not q
        if not q:
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            elif c == "," and depth == 0:
                parts.append(cur)
                cur = ""
                continue
        cur += c
    if cur:
        parts.append(cur)
    positional = []
    for p in parts:
        if "=" in p and not p.startswith("'"):
            k, v = p.split("=", 1)
            out[k.strip().upper()] = v.strip()
        else:
            positional.append(p.strip())
    if positional:
        out["_positional"] = ",".join(positional)
    return out


def _field(s: str) -> str:
    """The operand field: from the first non-blank to the first blank outside quotes (the rest is a comment)."""
    s = s.lstrip()
    q = False
    for k, c in enumerate(s):
        if c == "'":
            q = not q
        elif c == " " and not q:
            return s[:k]
    return s


def statements(text: str) -> tuple[list[Statement], dict[int, list[tuple[int, str]]]]:
    """JCL statements (continuations joined) and in-stream data: {line of the DD: [(line, text)]}."""
    lines = text.splitlines()
    out: list[Statement] = []
    instream: dict[int, list[tuple[int, str]]] = {}
    i = 0
    while i < len(lines):
        raw = lines[i].rstrip()[:72]
        if not raw.startswith("//") or raw.startswith("//*"):
            i += 1
            continue
        m = re.match(r"//(\S*)\s+(\S+)\s*(.*)$", raw)
        if not m:
            i += 1
            continue
        name, op, operands = m.group(1) or None, m.group(2).upper(), _field(m.group(3))
        start = i + 1
        # Continuation: the operand field ends with a comma; the next line is // followed by blanks.
        while operands.endswith(",") and i + 1 < len(lines) and re.match(r"//\s+\S", lines[i + 1]):
            i += 1
            operands += _field(lines[i].rstrip()[:72][2:])
        out.append(Statement(start, name, op, operands))
        if op == "DD" and re.match(r"^(\*|DATA)(,|$)", operands, re.I):
            data = []
            j = i + 1
            while j < len(lines) and not lines[j].startswith("/*") and not lines[j].startswith("//"):
                data.append((j + 1, lines[j].rstrip()))
                j += 1
            instream[start] = data
            i = j
            continue
        i += 1
    return out, instream


@dataclass
class Job:
    path: str
    name: str | None = None
    line: int = 0
    steps: list[dict] = field(default_factory=list)
    procs: list[dict] = field(default_factory=list)
    datasets: list[dict] = field(default_factory=list)


def analyze_jcl(path: str, text: str) -> Job:
    stmts, instream = statements(text)
    job = Job(path=path)
    step: dict | None = None
    last_dd: str | None = None
    for s in stmts:
        if s.op != "DD":
            last_dd = None
        if s.op == "JOB":
            job.name, job.line = (s.name or "").upper(), s.line
        elif s.op == "PROC":
            job.procs.append({"name": (s.name or "").upper(), "line": s.line})
        elif s.op == "EXEC":
            params = _parameters(s.operands)
            step = {"step": (s.name or "").upper() or None, "line": s.line}
            if "PGM" in params:
                step["program"] = params["PGM"].upper()
            else:
                step["proc"] = (params.get("PROC") or params.get("_positional", "").split(",")[0]).upper() or None
            if "COND" in params:
                step["cond"] = params["COND"]
            job.steps.append(step)
        elif s.op == "DD":
            params = _parameters(s.operands)
            dsn = params.get("DSN") or params.get("DSNAME")
            # An unnamed DD right after a named one is part of its concatenation (SORTIN: two datasets read as one).
            dd = (s.name or "").upper() or None
            concat = dd is None and last_dd is not None
            dd = dd or last_dd
            last_dd = dd
            if dsn:
                disp = params.get("DISP", "").strip("()").split(",")[0].upper() or "NEW"
                job.datasets.append({"step": step["step"] if step else None, "dd": dd, "dsn": dsn.upper(), "disp": disp, "line": s.line, **({"concatenated": True} if concat else {})})
            if s.line in instream and step is not None and dd:
                # Control statements read by the step's program (SORT, IDCAMS, SYMNAMES): kept for data lineage.
                step.setdefault("instream", {})[dd] = instream[s.line]
            if s.line in instream and step is not None:
                for ln, data in instream[s.line]:
                    m = re.search(r"\bRUN\s+PROGRAM\s*\(\s*([A-Z0-9#@$]+)\s*\)", data, re.I)
                    if m:
                        step["runs_program"] = m.group(1).upper()
                        step["runs_line"] = ln
                        step["via"] = "DSN RUN PROGRAM"
    return job


def analyze_csd(path: str, text: str) -> list[dict]:
    """DEFINE TRANSACTION(x) ... PROGRAM(y), DEFINE PROGRAM(y), DEFINE FILE(f) ... DSNAME(d). The same
    definitions written for the CICS resource builder (YAML, resourceDefinitions:) are read too."""
    if re.search(r"^resourceDefinitions\s*:", text, re.M):
        return _resource_yaml(text)
    out = []
    joined, starts = [], []
    for n, raw in enumerate(text.splitlines(), 1):
        if re.match(r"\s*DEFINE\b", raw, re.I):
            starts.append((len(joined), n))
        joined.append(raw)
    for k, (idx, line) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(joined)
        body = " ".join(joined[idx:end])
        kind = re.match(r"\s*DEFINE\s+([A-Z]+)\s*\(\s*([^)\s]+)", body, re.I)
        if not kind:
            continue
        rec = {"define": kind.group(1).upper(), "name": kind.group(2).upper().strip("'"), "line": line}
        for key in ("PROGRAM", "DSNAME", "GROUP", "TRANSID"):
            m = re.search(rf"\b{key}\s*\(\s*([^)\s]+)\s*\)", body[kind.end():], re.I)
            if m:
                rec[key.lower()] = m.group(1).upper().strip("'")
        out.append(rec)
    return out


def _resource_yaml(text: str) -> list[dict]:
    """Each list entry (- transaction:) with its keys one level down (name: OCR1, program: CRDTAGY1)."""
    out, rec = [], None
    for n, raw in enumerate(text.splitlines(), 1):
        head = re.match(r"\s*-\s+([a-z]+)\s*:\s*$", raw)
        if head:
            rec = {"define": head.group(1).upper(), "line": n}
            out.append(rec)
            continue
        kv = re.match(r"\s+([a-z]+)\s*:\s*\"?([^\"#]*?)\"?\s*(#.*)?$", raw)
        if rec is not None and kv and kv.group(1) in ("name", "program", "dsname", "group", "transid"):
            rec[kv.group(1) if kv.group(1) != "name" else "name"] = kv.group(2).strip().upper()
    return [r for r in out if r.get("name")]


def analyze_bms(path: str, text: str) -> list[dict]:
    """Mapsets (DFHMSD) and maps (DFHMDI) in a BMS source."""
    out = []
    for n, raw in enumerate(text.splitlines(), 1):
        m = re.match(r"([A-Z0-9#@$]+)\s+(DFHMSD|DFHMDI)\b", raw, re.I)
        if m:
            out.append({"name": m.group(1).upper(), "kind": "mapset" if m.group(2).upper() == "DFHMSD" else "map", "line": n})
    return out
