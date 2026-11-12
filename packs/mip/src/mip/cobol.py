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


def analyze(path: str, text: str, kind: str = "program") -> Program:
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
    _data(prog, head if kind == "program" else tokens)
    if kind == "copybook" and proc == -1:
        # A copybook may hold procedure code (performed paragraphs); scan it as such when it has verbs at statement starts.
        if any(t.upper in ("PERFORM", "CALL", "MOVE", "IF", "EVALUATE", "GO") for t in tokens):
            body = tokens
    if body:
        _procedure(prog, body)
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


def _data(prog: Program, tokens: list[Token]) -> None:
    """Data entries: level, name, parent, VALUE literals, USAGE, REDEFINES, OCCURS; and FD record names."""
    stack: list[DataItem] = []
    current_fd: str | None = None
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.upper in ("FD", "SD") and i + 1 < len(tokens):
            current_fd = tokens[i + 1].text.upper()
            i = _sentence_end(tokens, i) + 1
            continue
        if t.upper in ("WORKING-STORAGE", "LINKAGE", "LOCAL-STORAGE") and i + 1 < len(tokens) and tokens[i + 1].upper == "SECTION":
            current_fd = None
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
            item = DataItem(level=level, name=nm, line=t.line, parent=parent)
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
                if x.upper == "REDEFINES" and k + 1 < len(seg):
                    item.redefines = seg[k + 1].text.upper()
                if x.upper == "OCCURS" and k + 1 < len(seg) and seg[k + 1].text.isdigit():
                    item.occurs = int(seg[k + 1].text)
                if x.upper in ("POINTER", "PROCEDURE-POINTER", "FUNCTION-POINTER", "COMP", "COMP-3", "COMP-5", "BINARY", "PACKED-DECIMAL", "INDEX"):
                    item.usage = x.upper
            if level == 1 and current_fd:
                prog.fds[nm] = current_fd
            if nm != "FILLER" and nm not in prog.data:
                prog.data[nm] = item
            prog.items.append(item)
            if level not in (66, 88):
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
