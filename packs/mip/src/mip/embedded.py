"""
The languages embedded in COBOL (L2): EXEC CICS, EXEC SQL (through SQLGlot) and IMS DL/I
(EXEC DLI blocks and CALL 'CBLTDLI'). Each block becomes one fact, cited at the line of
its EXEC, with the command, its options and, where it names a program, file, transaction,
table or segment, that target as written.
"""
from __future__ import annotations

import re

from .cobol import ExecBlock, Program, literal_values
from .source import Token

# Commands whose first option name completes the command's name (SEND MAP, RETURN TRANSID…).
_TWO_WORD = {"SEND", "RECEIVE", "GET", "PUT", "INQUIRE", "SET", "WRITEQ", "READQ", "DELETEQ", "START", "RETURN", "HANDLE", "IGNORE"}


def cics_options(tokens: list[Token]) -> tuple[str, dict[str, dict]]:
    """The command and its options: NAME(value) pairs, each value kept as written (a literal or a data name)."""
    if not tokens:
        return "?", {}
    command = tokens[0].upper
    opts: dict[str, dict] = {}
    i = 1
    while i < len(tokens):
        t = tokens[i]
        if t.kind == "word" and i + 1 < len(tokens) and tokens[i + 1].text == "(":
            depth, j = 1, i + 2
            while j < len(tokens) and depth:
                depth += {"(": 1, ")": -1}.get(tokens[j].text, 0)
                j += 1
            inner = tokens[i + 2 : j - 1]
            if len(inner) == 1 and inner[0].kind == "literal":
                opts[t.upper] = {"literal": inner[0].text.strip().upper(), "line": t.line}
            else:
                # A data name, maybe qualified (X OF Y) or subscripted (X(WS-OPTION)): keep the name apart from its subscript.
                head, sub, depth = [], [], 0
                for x in inner:
                    if x.text == "(":
                        depth += 1
                    elif x.text == ")":
                        depth -= 1
                    elif x.kind == "word":
                        (sub if depth else head).append(x.text.upper())
                opts[t.upper] = {"name": " ".join(head), "line": t.line, **({"subscript": " ".join(sub)} if sub else {})}
            i = j
            continue
        if t.kind == "word":
            opts.setdefault(t.upper, {"flag": True, "line": t.line})
        i += 1
    if command in _TWO_WORD and len(tokens) > 1 and tokens[1].kind == "word" and tokens[1].upper in ("MAP", "TEXT", "CONTROL", "CONTAINER", "TRANSID", "TS", "TD", "ASSOCIATION", "PROGRAM", "CONDITION", "ABEND", "AID", "PAGE"):
        command = f"{command} {tokens[1].upper}"
    return command, opts


def _target(opt: dict | None) -> tuple[str | None, str | None]:
    """(literal target, data name) from one option."""
    if not opt:
        return None, None
    if "literal" in opt:
        return opt["literal"].strip(), None
    name = opt.get("name", "").split(" OF ")[0].split(" IN ")[0].strip()
    return None, name or None


def cics_facts(prog: Program, block: ExecBlock, copied: list[Program]) -> dict:
    command, opts = cics_options(block.tokens)
    fact: dict = {"command": command, "line": block.line, "end": block.end}
    for key in ("PROGRAM", "TRANSID", "FILE", "DATASET", "MAP", "MAPSET", "QUEUE", "COMMAREA", "CHANNEL", "CONTAINER", "LENGTH"):
        lit, name = _target(opts.get(key))
        if lit:
            fact[key.lower()] = lit
        elif name:
            fact[key.lower()] = name
            if opts[key].get("subscript"):
                fact[f"{key.lower()}_subscript"] = opts[key]["subscript"]
            if key in ("PROGRAM", "TRANSID", "FILE", "DATASET", "QUEUE"):
                fact[f"{key.lower()}_dynamic"] = True
                fact[f"{key.lower()}_values"] = literal_values(prog, name, copied)
    return fact


# ── SQL ─────────────────────────────────────────────────────────────────────

def _sql_normalize(text: str) -> str:
    s = re.sub(r":\s*([A-Z][A-Z0-9-]*)(\s*:\s*[A-Z][A-Z0-9-]*)?", lambda m: ":" + m.group(1).replace("-", "_"), text, flags=re.I)
    s = re.sub(r"\bINTO\s+:[A-Z0-9_]+(?:\s*,\s*:[A-Z0-9_]+)*\s+(?=FROM\b)", "", s, flags=re.I)
    s = re.sub(r"^\s*DECLARE\s+\S+\s+CURSOR\s+(?:WITH\s+(?:HOLD|RETURN)\s+)?FOR\s+", "", s, flags=re.I)
    s = re.sub(r"\bFOR\s+(?:FETCH|READ)\s+ONLY\b|\bFOR\s+UPDATE(?:\s+OF\s+[A-Z0-9_,\s]+)?$|\bWITH\s+(?:UR|CS|RS|RR)\b|\bFETCH\s+FIRST\s+\d+\s+ROWS?\s+ONLY\b|\bOPTIMIZE\s+FOR\s+\d+\s+ROWS?\b", "", s, flags=re.I)
    return s


def sql_facts(block: ExecBlock) -> dict:
    text = block.text()
    verb_m = re.match(r"\s*([A-Z]+)", text, re.I)
    verb = verb_m.group(1).upper() if verb_m else "?"
    fact: dict = {"verb": verb, "line": block.line, "end": block.end}
    if verb == "DECLARE":
        m = re.match(r"\s*DECLARE\s+([A-Z0-9_-]+)\s+(CURSOR|TABLE)\b", text, re.I)
        if m:
            fact["declares"] = m.group(2).upper()
            fact["name"] = m.group(1).upper()
    if verb in ("OPEN", "CLOSE", "FETCH"):
        m = re.match(r"\s*(?:OPEN|CLOSE|FETCH)\s+(?:NEXT\s+)?(?:FROM\s+)?([A-Z0-9_-]+)", text, re.I)
        if m:
            fact["cursor"] = m.group(1).upper()
    if verb == "INCLUDE":
        m = re.match(r"\s*INCLUDE\s+([A-Z0-9_-]+)", text, re.I)
        if m:
            fact["include"] = m.group(1).upper()
        return fact
    tables: list[str] = []
    if verb in ("SELECT", "INSERT", "UPDATE", "DELETE", "MERGE") or fact.get("declares") == "CURSOR":
        try:
            import sqlglot
            from sqlglot import exp

            tree = sqlglot.parse_one(_sql_normalize(text))
            tables = sorted({t.name.upper() for t in tree.find_all(exp.Table) if t.name})
            fact["parsed_by"] = "sqlglot"
        except Exception:  # noqa: BLE001 - a dialect sqlglot doesn't take: fall back, and say so
            tables = sorted({t.upper() for t in re.findall(r"\b(?:FROM|INTO|UPDATE|JOIN)\s+([A-Z][A-Z0-9_.]*)", text, re.I) if not t.startswith(":")})
            fact["parsed_by"] = "pattern"
    if fact.get("declares") == "TABLE":
        tables = [fact["name"]]
    fact["tables"] = tables
    return fact


# ── IMS DL/I ────────────────────────────────────────────────────────────────

DLI_READS = {"GU", "GHU", "GN", "GHN", "GNP", "GHNP"}
DLI_WRITES = {"ISRT": "writes", "REPL": "updates", "DLET": "deletes"}


def dli_exec_facts(block: ExecBlock) -> dict:
    command, opts = cics_options(block.tokens)
    fact: dict = {"function": command, "interface": "EXEC DLI", "line": block.line, "end": block.end}
    for key in ("SEGMENT", "PCB", "PSB", "INTO", "FROM", "USING"):
        lit, name = _target(opts.get(key))
        if lit or name:
            fact[key.lower()] = lit or name
    if "PCB" in opts and "pcb" not in fact:
        fact["pcb"] = opts["PCB"].get("name")
    return fact


def _segment_of(prog: Program, ssa: str, copied: list[Program]) -> str | None:
    """An SSA's segment name: the first VALUE under the SSA group (e.g. 'PAUTSUM0(' or 'ACCOUNT ')."""
    for src in (prog, *copied):
        item = src.data.get(ssa)
        if not item:
            continue
        if item.values:
            return re.split(r"[ (*]", item.values[0].strip(), maxsplit=1)[0] or None
        for child in src.items:
            if child.parent == ssa and child.values:
                return re.split(r"[ (*]", child.values[0].strip(), maxsplit=1)[0] or None
    return None


def dli_call_facts(prog: Program, call: dict, copied: list[Program]) -> dict:
    """CALL 'CBLTDLI' USING function pcb io-area [ssa…]: the function code resolved from its VALUE."""
    args = call.get("using", [])
    fact: dict = {"interface": call["target"], "line": call["line"], "scope": call.get("scope"), "args": args}
    if args:
        func = args[0]
        if re.fullmatch(r"[A-Z]{2,4}", func.strip()):
            fact["function"] = func.strip()
        else:
            vals = literal_values(prog, func, copied)
            fact["function_via"] = func
            if vals:
                fact["function"] = vals[0]["value"].strip()
    if len(args) > 1:
        fact["pcb"] = args[1]
    ssas = [a for a in args[3:]]
    segs = [s for s in (_segment_of(prog, a, copied) for a in ssas) if s]
    if segs:
        fact["segments"] = segs
    return fact
