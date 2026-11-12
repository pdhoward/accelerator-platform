"""
COBOL structure (L2): what a program contains and whom it talks to, every fact cited to
the line of the file it came from. Works on tokens (source.py), not on a full grammar:
statements are found by their verbs, EXEC blocks are cut out first and handed to the
CICS, SQL and DL/I readers, so a verb inside a block is never taken for COBOL.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .source import Token, tokenize

# Words that can start a statement in the PROCEDURE DIVISION (enough to end the previous one).
VERBS = {
    "ACCEPT", "ADD", "ALLOCATE", "CALL", "CANCEL", "CLOSE", "COMPUTE", "CONTINUE", "DELETE", "DISPLAY", "DIVIDE",
    "ELSE", "END-IF", "END-EVALUATE", "END-PERFORM", "END-READ", "END-CALL", "END-STRING", "END-COMPUTE", "EVALUATE",
    "EXEC", "EXIT", "FREE", "GOBACK", "GO", "IF", "INITIALIZE", "INSPECT", "INVOKE", "MERGE", "MOVE", "MULTIPLY", "NEXT",
    "OPEN", "PERFORM", "READ", "RELEASE", "RETURN", "REWRITE", "SEARCH", "SET", "SORT", "START", "STOP", "STRING",
    "SUBTRACT", "UNSTRING", "WHEN", "WRITE", "XML", "JSON",
}
NOT_PARAGRAPH = {"EXIT", "GOBACK", "CONTINUE", "STOP", "END-IF", "END-EVALUATE", "END-PERFORM", "ELSE", "DECLARATIVES", "END"}
IMS_INTERFACES = {"CBLTDLI", "AIBTDLI", "CEETDLI", "PLITDLI", "DFSLI000"}


@dataclass
class DataItem:
    level: int
    name: str
    line: int
    parent: str | None
    values: list[str] = field(default_factory=list)
    usage: str | None = None  # POINTER, PROCEDURE-POINTER, FUNCTION-POINTER, COMP…
    redefines: str | None = None
    occurs: int | None = None
    pic: str | None = None
    section: str | None = None  # WORKING-STORAGE, LINKAGE, LOCAL-STORAGE, FILE
    sign_separate: bool = False
    depending: str | None = None  # OCCURS … DEPENDING ON
    copy: str | None = None  # a COPY marker: the copybook whose items sit here
    extends: "DataItem | None" = None  # a copied 01 record this program goes on adding fields to (COPY COCOM01Y. 05 …)
    children: list = field(default_factory=list)
    path: str | None = None  # the file it was declared in


@dataclass
class ExecBlock:
    kind: str  # CICS, SQL, DLI or other
    line: int
    end: int
    tokens: list[Token]
    unterminated: bool = False  # no END-EXEC before the next EXEC

    def text(self) -> str:
        parts = []
        for t in self.tokens:
            parts.append(f"'{t.text}'" if t.kind == "literal" else t.text)
        s = " ".join(parts)
        return re.sub(r":\s+", ":", s)


@dataclass
class Program:
    path: str
    name: str
    kind: str  # "program" or "copybook"
    lines: int
    paragraphs: list[dict] = field(default_factory=list)
    data: dict[str, DataItem] = field(default_factory=dict)
    items: list[DataItem] = field(default_factory=list)  # every entry in order, FILLERs included (an SSA's segment name is often a FILLER)
    roots: list[DataItem] = field(default_factory=list)  # 01 and 77 items (and a copybook's top items), with their children
    varying: list[dict] = field(default_factory=list)  # PERFORM VARYING loops with literal bounds (constant evaluation, P2)
    commarea_copy: list[dict] = field(default_factory=list)  # MOVE DFHCOMMAREA … TO record: where an untyped COMMAREA is read
    used: set = field(default_factory=set)  # every word the PROCEDURE DIVISION (and its EXEC blocks) mentions
    copies: list[dict] = field(default_factory=list)
    performs: list[dict] = field(default_factory=list)
    gotos: list[dict] = field(default_factory=list)
    calls: list[dict] = field(default_factory=list)
    moves: list[dict] = field(default_factory=list)  # literal → data name
    strings: list[dict] = field(default_factory=list)  # STRING ... INTO name (for constant evaluation, P2)
    selects: list[dict] = field(default_factory=list)
    fds: dict[str, str] = field(default_factory=dict)  # record name → file name
    file_io: list[dict] = field(default_factory=list)
    execs: list[ExecBlock] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)


def _sentence_end(tokens: list[Token], i: int) -> int:
    while i < len(tokens) and tokens[i].text != ".":
        i += 1
    return i


def _cut_execs(tokens: list[Token]) -> tuple[list[Token], list[ExecBlock]]:
    """Remove every EXEC ... END-EXEC block from the stream; keep them apart."""
    rest, blocks = [], []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.upper == "EXEC" and i + 1 < len(tokens):
            j = i + 1
            # A block ends at END-EXEC; a second EXEC before it means END-EXEC was lost (e.g. past column 72): end there.
            while j < len(tokens) and tokens[j].upper != "END-EXEC" and not (tokens[j].upper == "EXEC" and j + 1 < len(tokens) and tokens[j + 1].upper in ("CICS", "SQL", "DLI", "SQLIMS")):
                j += 1
            if j < len(tokens) and tokens[j].upper == "EXEC":
                kind = tokens[i + 1].upper if tokens[i + 1].upper in ("CICS", "SQL", "DLI", "SQLIMS") else "OTHER"
                blocks.append(ExecBlock(kind, t.line, tokens[j - 1].line, tokens[i + 2 : j], unterminated=True))
                i = j
                continue
            kind = tokens[i + 1].upper if tokens[i + 1].upper in ("CICS", "SQL", "DLI", "SQLIMS") else "OTHER"
            body = tokens[i + 2 : j]
            blocks.append(ExecBlock(kind, t.line, tokens[min(j, len(tokens) - 1)].line, body))
            i = j + 1
            continue
        rest.append(t)
        i += 1
    return rest, blocks


def _find(tokens: list[Token], *words: str, start: int = 0) -> int:
    n = len(words)
    for i in range(start, len(tokens) - n + 1):
        if all(tokens[i + k].upper == words[k] for k in range(n)):
            return i
    return -1


def analyze(path: str, text: str, kind: str = "program", copybooks: dict | None = None) -> Program:
    """`copybooks`: the copybooks this file can see (name → Program), so a COPY that opens an 01 record
    can be continued by the fields that follow it, as the compiler would."""
    all_tokens = tokenize(text)
    tokens, execs = _cut_execs(all_tokens)
    name = re.sub(r"\.[^.]+$", "", path.rsplit("/", 1)[-1]).upper()
    pid = _find(tokens, "PROGRAM-ID")
    if pid != -1:
        j = pid + 1
        while j < len(tokens) and tokens[j].text in (".",):
            j += 1
        if j < len(tokens):
            name = tokens[j].text.upper()
    prog = Program(path=path, name=name, kind=kind, lines=text.count("\n") + 1, execs=execs)

    proc = _find(tokens, "PROCEDURE", "DIVISION")
    data_start = _find(tokens, "DATA", "DIVISION")
    env_end = data_start if data_start != -1 else (proc if proc != -1 else len(tokens))
    head = tokens[: proc if proc != -1 else len(tokens)]
    body = tokens[proc:] if proc != -1 else ([] if kind == "program" else tokens)

    _copies(prog, tokens)
    _file_control(prog, tokens[:env_end] if kind == "program" else tokens)
    _data(prog, head if kind == "program" else tokens, copybooks or {})
    if kind == "copybook" and proc == -1:
        # A copybook may hold procedure code (performed paragraphs); scan it as such when it has verbs at statement starts.
        if any(t.upper in ("PERFORM", "CALL", "MOVE", "IF", "EVALUATE", "GO") for t in tokens):
            body = tokens
    if body:
        _procedure(prog, body)
        prog.used = {t.upper for t in body if t.kind == "word"}
        proc_line = body[0].line if body else 0
        for blk in execs:
            if blk.line >= proc_line:
                prog.used.update(t.upper for t in blk.tokens if t.kind == "word")
    return prog


def _copies(prog: Program, tokens: list[Token]) -> None:
    for i, t in enumerate(tokens):
        if t.upper == "COPY" and i + 1 < len(tokens):
            nm = tokens[i + 1]
            end = _sentence_end(tokens, i)
            seg = tokens[i + 2 : end]
            lib = None
            if len(seg) >= 2 and seg[0].upper in ("OF", "IN"):
                lib = seg[1].text.upper()
            rec = {"copybook": nm.text.upper(), "line": t.line}
            if lib:
                rec["library"] = lib
            if any(x.upper == "REPLACING" for x in seg):
                rec["replacing"] = True
            prog.copies.append(rec)


def _file_control(prog: Program, tokens: list[Token]) -> None:
    i = 0
    while True:
        i = _find(tokens, "SELECT", start=i)
        if i == -1:
            return
        end = _sentence_end(tokens, i)
        seg = tokens[i:end]
        rec: dict = {"file": seg[1].text.upper() if len(seg) > 1 and seg[1].upper != "OPTIONAL" else (seg[2].text.upper() if len(seg) > 2 else "?"), "line": seg[0].line}
        for k, t in enumerate(seg):
            if t.upper == "ASSIGN":
                nxt = [x for x in seg[k + 1 : k + 4] if x.upper not in ("TO", "USING")]
                if nxt:
                    rec["assign"] = nxt[0].text.upper()
            if t.upper == "ORGANIZATION":
                nxt = [x for x in seg[k + 1 : k + 3] if x.upper != "IS"]
                if nxt:
                    rec["organization"] = nxt[0].upper
            if t.upper == "INDEXED" and "organization" not in rec:
                rec["organization"] = "INDEXED"
            if t.upper == "ACCESS":
                nxt = [x for x in seg[k + 1 : k + 3] if x.upper not in ("MODE", "IS")]
                if nxt:
                    rec["access"] = nxt[0].upper
            if t.upper == "RECORD" and k + 1 < len(seg) and seg[k + 1].upper == "KEY":
                nxt = [x for x in seg[k + 2 : k + 4] if x.upper != "IS"]
                if nxt:
                    rec["record_key"] = nxt[0].text.upper()
        prog.selects.append(rec)
        i = end + 1


_LEVEL = re.compile(r"^(0?[1-9]|[1-4][0-9]|66|77|88)$")


def _data(prog: Program, tokens: list[Token], copybooks: dict | None = None) -> None:
    """Data entries as a tree: level, name, PICTURE, USAGE, VALUE literals, REDEFINES, OCCURS (and DEPENDING ON),
    SIGN SEPARATE, the section, and COPY markers where a copybook's items sit; and FD record names."""
    stack: list[DataItem] = []
    current_fd: str | None = None
    section: str | None = None
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.upper in ("FD", "SD") and i + 1 < len(tokens):
            current_fd = tokens[i + 1].text.upper()
            section = "FILE"
            stack = []
            i = _sentence_end(tokens, i) + 1
            continue
        if t.upper in ("WORKING-STORAGE", "LINKAGE", "LOCAL-STORAGE", "FILE") and i + 1 < len(tokens) and tokens[i + 1].upper == "SECTION":
            current_fd = None
            section = t.upper
            stack = []
        if t.upper == "COPY" and i + 1 < len(tokens):
            marker = DataItem(level=0, name=f"COPY:{tokens[i + 1].text.upper()}", line=t.line, parent=stack[-1].name if stack else None, copy=tokens[i + 1].text.upper(), section=section, path=prog.path)
            # REPLACING a BY b (words or ==pseudo-text==): the names the copied items take here.
            seg = tokens[i + 2 : _sentence_end(tokens, i)]
            if any(x.upper == "REPLACING" for x in seg):
                ops = [x.text.upper() for x in seg[[x.upper for x in seg].index("REPLACING") + 1 :] if x.kind in ("word", "pseudo", "literal")]
                marker.values = [f"{ops[k]}=>{ops[k + 2]}" for k in range(0, len(ops) - 2, 3) if ops[k + 1] == "BY"]
            cp = (copybooks or {}).get(marker.copy)
            opens = [r for r in (cp.roots if cp else []) if not r.copy and r.level == 1]
            if opens and not marker.values:
                # The copybook opens 01 record(s): they are records of their own, and fields that follow continue the last one.
                prog.roots.append(marker)
                prog.items.append(marker)
                last = opens[-1]
                proxy = DataItem(level=1, name=last.name, line=last.line, parent=None, section=section, path=last.path, extends=last)
                stack = [proxy]
                prog.items.append(proxy)
                if last.name not in prog.data:
                    prog.data[last.name] = proxy
                i = _sentence_end(tokens, i) + 1
                continue
            (stack[-1].children if stack else prog.roots).append(marker)
            prog.items.append(marker)
            i = _sentence_end(tokens, i) + 1
            continue
        if t.kind == "word" and _LEVEL.match(t.text) and t.col <= 40 and i + 1 < len(tokens):
            level = int(t.text)
            nm_tok = tokens[i + 1]
            nm = nm_tok.text.upper() if nm_tok.kind == "word" else "FILLER"
            end = _sentence_end(tokens, i)
            seg = tokens[i + 2 : end]
            if nm_tok.text == ".":
                nm = "FILLER"
            if level in (1, 77):
                stack = []
            while stack and stack[-1].level >= level and level not in (66, 88):
                stack.pop()
            parent = stack[-1].name if stack and level != 77 else None
            item = DataItem(level=level, name=nm, line=t.line, parent=parent, section=section, path=prog.path)
            for k, x in enumerate(seg):
                if x.upper in ("VALUE", "VALUES"):
                    for y in seg[k + 1 :]:
                        if y.upper in ("IS", "ARE"):
                            continue
                        if y.kind == "literal":
                            item.values.append(y.text)
                        elif y.upper in ("SPACE", "SPACES", "ZERO", "ZEROS", "ZEROES", "LOW-VALUES", "HIGH-VALUES"):
                            item.values.append(y.upper)
                        elif re.match(r"^[+-]?\d", y.text):
                            item.values.append(y.text)
                        elif y.upper in ("THRU", "THROUGH", ","):
                            continue
                        else:
                            break
                if x.kind == "pic":
                    item.pic = x.text.upper()
                if x.upper == "REDEFINES" and k + 1 < len(seg):
                    item.redefines = seg[k + 1].text.upper()
                if x.upper == "OCCURS" and k + 1 < len(seg) and seg[k + 1].text.isdigit():
                    item.occurs = int(seg[k + 1].text)
                    if k + 3 < len(seg) and seg[k + 2].upper == "TO" and seg[k + 3].text.isdigit():
                        item.occurs = int(seg[k + 3].text)  # the maximum
                if x.upper == "DEPENDING":
                    on = [y for y in seg[k + 1 : k + 3] if y.upper != "ON"]
                    if on:
                        item.depending = on[0].text.upper()
                if x.upper == "SEPARATE":
                    item.sign_separate = True
                if x.upper in ("POINTER", "PROCEDURE-POINTER", "FUNCTION-POINTER", "COMP", "COMP-1", "COMP-2", "COMP-3", "COMP-4", "COMP-5",
                               "COMPUTATIONAL", "COMPUTATIONAL-3", "COMPUTATIONAL-5", "BINARY", "PACKED-DECIMAL", "INDEX", "DISPLAY", "NATIONAL"):
                    item.usage = {"COMPUTATIONAL": "COMP", "COMPUTATIONAL-3": "COMP-3", "COMPUTATIONAL-5": "COMP-5", "COMP-4": "COMP", "BINARY": "COMP", "PACKED-DECIMAL": "COMP-3"}.get(x.upper, x.upper)
            if level == 1 and current_fd:
                prog.fds[nm] = current_fd
            if nm != "FILLER" and nm not in prog.data:
                prog.data[nm] = item
            prog.items.append(item)
            if level not in (66, 88):
                if stack and level != 77:
                    stack[-1].children.append(item)
                else:
                    prog.roots.append(item)
                stack.append(item)
            i = end + 1
            continue
        i += 1


def _procedure(prog: Program, tokens: list[Token]) -> None:
    current: str | None = None
    # Paragraph and section headers: a word in Area A followed by '.' (or SECTION '.').
    headers: dict[int, str] = {}
    for i, t in enumerate(tokens):
        if t.kind != "word" or not t.area_a or t.upper in NOT_PARAGRAPH or t.upper in VERBS:
            continue
        if i + 1 < len(tokens) and tokens[i + 1].text == ".":
            headers[i] = "paragraph"
        elif i + 2 < len(tokens) and tokens[i + 1].upper == "SECTION" and tokens[i + 2].text == ".":
            headers[i] = "section"
        elif i + 1 < len(tokens) and tokens[i + 1].upper == "DIVISION":
            continue
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if i in headers:
            current = t.upper
            prog.paragraphs.append({"name": current, "kind": headers[i], "line": t.line})
            i += 1
            continue
        u = t.upper
        scope = current
        if u == "PERFORM" and i + 1 < len(tokens) and tokens[i + 1].upper == "VARYING":
            loop = _varying(tokens, i)
            if loop:
                prog.varying.append(loop)
        if u == "MOVE" and i + 1 < len(tokens) and tokens[i + 1].upper == "DFHCOMMAREA":
            k = i + 2
            while k < len(tokens) and tokens[k].upper != "TO" and tokens[k].text != ".":
                k += 1
            if k + 1 < len(tokens) and tokens[k].upper == "TO":
                # (1:EIBCALEN): only the bytes actually passed are copied; the rest keeps the program's own values.
                bounded = any(x.upper == "EIBCALEN" for x in tokens[i + 2 : k])
                prog.commarea_copy.append({"to": tokens[k + 1].upper, "line": t.line, "bounded": bounded})
        if u == "PERFORM" and i + 1 < len(tokens):
            nxt = tokens[i + 1]
            if nxt.kind == "word" and nxt.upper not in ("UNTIL", "VARYING", "WITH", "TEST", "FOREVER") and not nxt.text.isdigit() and nxt.upper not in VERBS:
                rec = {"target": nxt.upper, "line": t.line, "scope": scope}
                k = i + 2
                if k + 1 < len(tokens) and tokens[k].upper in ("THRU", "THROUGH"):
                    rec["thru"] = tokens[k + 1].upper
                if k < len(tokens) and tokens[k].upper in ("OF", "IN") and k + 1 < len(tokens):
                    rec["section"] = tokens[k + 1].upper
                prog.performs.append(rec)
        elif u == "GO" and i + 1 < len(tokens) and tokens[i + 1].upper == "TO":
            k = i + 2
            targets = []
            while k < len(tokens) and tokens[k].kind == "word" and tokens[k].upper not in VERBS and tokens[k].upper not in ("DEPENDING", "END-IF"):
                targets.append(tokens[k].upper)
                k += 1
            for tg in targets:
                prog.gotos.append({"target": tg, "line": t.line, "scope": scope, **({"depending": True} if len(targets) > 1 else {})})
        elif u == "CALL" and i + 1 < len(tokens):
            nxt = tokens[i + 1]
            args = []
            k = i + 2
            if k < len(tokens) and tokens[k].upper == "USING":
                k += 1
                while k < len(tokens) and tokens[k].upper not in VERBS and tokens[k].text != "." and tokens[k].upper not in ("RETURNING", "GIVING", "ON", "NOT", "END-CALL", "OVERFLOW", "EXCEPTION"):
                    if tokens[k].kind in ("word", "literal") and tokens[k].upper not in ("BY", "REFERENCE", "CONTENT", "VALUE", "ADDRESS", "OF", "LENGTH", "OMITTED"):
                        args.append(tokens[k].text.upper())
                    k += 1
            if nxt.kind == "literal":
                prog.calls.append({"target": nxt.text.strip().upper(), "line": t.line, "scope": scope, "using": args})
            elif nxt.kind == "word":
                prog.calls.append({"via": nxt.upper, "line": t.line, "scope": scope, "using": args, "dynamic": True})
        elif u == "MOVE" and i + 3 < len(tokens) and tokens[i + 1].kind == "literal":
            k = i + 2
            if tokens[k].upper == "TO":
                k += 1
                while k < len(tokens) and tokens[k].kind == "word" and tokens[k].upper not in VERBS and tokens[k].text != ".":
                    if tokens[k].upper not in ("OF", "IN"):
                        prog.moves.append({"value": tokens[i + 1].text, "to": tokens[k].upper, "line": t.line})
                    k += 1
        elif u == "STRING":
            end = k = i + 1
            while end < len(tokens) and tokens[end].upper not in ("END-STRING",) and tokens[end].text != ".":
                end += 1
            seg = tokens[i + 1 : end]
            into = next((seg[x + 1].upper for x in range(len(seg) - 1) if seg[x].upper == "INTO"), None)
            if into:
                prog.strings.append({"into": into, "line": t.line, "parts": [(x.kind, x.text) for x in seg[: next(x for x in range(len(seg)) if seg[x].upper == "INTO")]]})
        elif u in ("READ", "WRITE", "REWRITE", "DELETE", "START") and i + 1 < len(tokens) and tokens[i + 1].kind == "word":
            target = tokens[i + 1].upper
            file = prog.fds.get(target, target) if u in ("WRITE", "REWRITE") else target
            prog.file_io.append({"verb": u, "file": file, "line": t.line, "scope": scope, **({"record": target} if file != target else {})})
        elif u == "OPEN":
            k = i + 1
            mode = None
            while k < len(tokens) and tokens[k].text != "." and (tokens[k].upper not in VERBS or tokens[k].upper in ("INPUT", "OUTPUT", "I-O", "EXTEND")):
                w = tokens[k].upper
                if w in ("INPUT", "OUTPUT", "I-O", "EXTEND"):
                    mode = w
                elif mode and tokens[k].kind == "word":
                    prog.file_io.append({"verb": "OPEN", "mode": mode, "file": w, "line": tokens[k].line, "scope": scope})
                k += 1
        i += 1


_CMP = {">": "gt", ">=": "ge", "=": "eq", "GREATER": "gt", "EQUAL": "eq", "NOT": None}


def _varying(tokens: list[Token], i: int) -> dict | None:
    """PERFORM VARYING var FROM a BY b UNTIL var > c (literal bounds), with the lines it spans
    (inline: to its END-PERFORM; out of line: the PERFORM sentence)."""
    seg = tokens[i : i + 14]
    words = [t.upper for t in seg]
    try:
        var = words[2]
        a = int(words[words.index("FROM") + 1])
        b = int(words[words.index("BY") + 1]) if "BY" in words else 1
        u = words.index("UNTIL")
    except (ValueError, IndexError):
        return None
    if words[u + 1] != var:
        return None
    rest = words[u + 2 :]
    op = None
    if rest[:2] == [">", "="]:
        op, lim = "ge", rest[2:3]
    elif rest and rest[0] in (">", "="):
        op, lim = _CMP[rest[0]], rest[1:2]
    elif rest[:2] == ["GREATER", "THAN"]:
        op, lim = "gt", rest[2:3]
    elif rest[:1] == ["GREATER"]:
        op, lim = "gt", rest[1:2]
    elif rest[:2] == ["EQUAL", "TO"]:
        op, lim = "eq", rest[2:3]
    else:
        return None
    if not lim or not re.fullmatch(r"\d+", lim[0]):
        return None
    c = int(lim[0])
    values, n = [], a
    while len(values) < 100 and not ((op == "gt" and n > c) or (op == "ge" and n >= c) or (op == "eq" and n == c)):
        values.append(n)
        n += b
    # Its extent: an inline loop runs to the matching END-PERFORM.
    depth, j, end = 0, i, tokens[i].line
    while j < len(tokens):
        # Only an inline PERFORM (UNTIL, VARYING, WITH TEST, n TIMES) has an END-PERFORM; PERFORM X doesn't.
        if tokens[j].upper == "PERFORM" and j + 1 < len(tokens) and (tokens[j + 1].upper in ("UNTIL", "VARYING", "WITH", "TEST", "FOREVER") or tokens[j + 1].text.isdigit()):
            depth += 1
        elif tokens[j].upper == "END-PERFORM":
            depth -= 1
            if depth == 0:
                end = tokens[j].line
                break
        j += 1
    return {"var": var, "values": values, "line": tokens[i].line, "end": end}


def string_values(prog: Program, into: str, at_line: int | None = None, extra: list[Program] = ()) -> list[dict]:
    """Constant evaluation of STRING ... INTO var: literals, and variables with known values (a literal
    VALUE or MOVE, or the counter of an enclosing PERFORM VARYING with literal bounds, formatted by its PICTURE)."""
    out = []
    for st in prog.strings:
        if st["into"] != into.upper() or (at_line is not None and st["line"] > at_line):
            continue
        operands, k, parts = [], 0, st["parts"]
        while k < len(parts):
            kind, text = parts[k]
            if kind in ("literal", "word") and text.upper() not in ("DELIMITED", "BY", "SIZE", "SPACE", "SPACES", ","):
                delim = "SIZE"
                if k + 2 < len(parts) and parts[k + 1][1].upper() == "DELIMITED":
                    j = k + 2 if parts[k + 2][1].upper() != "BY" else k + 3
                    delim = parts[j][1].upper() if j < len(parts) else "SIZE"
                    k = j
                operands.append((kind, text, delim))
            k += 1
        combos = [""]
        for kind, text, delim in operands:
            if kind == "literal":
                vals = [text]
            else:
                loop = next((l for l in prog.varying if l["var"] == text.upper() and l["line"] <= st["line"] <= l["end"]), None)
                item = prog.data.get(text.upper()) or next((x.data[text.upper()] for x in extra if text.upper() in x.data), None)
                if loop:
                    width = _display_width(item)
                    vals = [str(v).rjust(width, "0") if width else str(v) for v in loop["values"]]
                else:
                    vals = [v["value"] for v in literal_values(prog, text, extra)]
            if not vals:
                combos = []
                break
            vals = [v.split(" ")[0] if delim in ("SPACE", "SPACES") else v for v in vals]
            combos = [c + v for c in combos for v in vals][:200]
        for v in combos:
            out.append({"value": v, "line": st["line"], "how": "STRING"})
    return out


def _display_width(item) -> int:
    if not item or not item.pic or item.usage not in (None, "DISPLAY"):
        return 0
    pic = re.sub(r"(.)\((\d+)\)", lambda m: m.group(1) * int(m.group(2)), item.pic)
    return sum(1 for c in pic if c == "9")


def literal_values(prog: Program, var: str, extra: list[Program] = ()) -> list[dict]:
    """Where a data name gets a literal: its VALUE (in the program or a copybook it copies) and MOVE 'x' TO it."""
    var = var.upper()
    out = []
    for src in (prog, *extra):
        item = src.data.get(var)
        if item:
            for v in item.values:
                out.append({"value": v.strip(), "line": item.line, "how": "VALUE", **({"file": src.path} if src is not prog else {})})
    for m in prog.moves:
        if m["to"] == var:
            out.append({"value": m["value"].strip(), "line": m["line"], "how": "MOVE"})
    seen, uniq = set(), []
    for o in out:
        if o["value"] not in seen and o["value"] not in ("SPACE", "SPACES", "LOW-VALUES", "HIGH-VALUES", "ZERO", "ZEROS", ""):
            seen.add(o["value"])
            uniq.append(o)
    return uniq
