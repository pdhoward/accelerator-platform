"""
L3 semantics within a program (P3): statements as a tree, the conditions each one sits under,
how paragraphs and sections reach each other, and where every field is set and read.

Native: a recursive reader over the PROCEDURE DIVISION's tokens (EXEC blocks in place).
- Statements: IF/ELSE, EVALUATE/WHEN, inline PERFORM loops, conditional phrases (AT END,
  INVALID KEY, ON EXCEPTION, ON SIZE ERROR and their NOTs), EXEC blocks, everything else
  as a simple statement. A period ends every open scope, as in COBOL.
- Guards: the conditions a statement runs under, including "earlier exits": after
  `IF cond … GO TO X END-IF` with no ELSE, what follows runs only when cond is false.
- Data: which fields a statement sets (and from what) and which it reads; EXEC SQL INTO
  host variables mapped column by column; CICS options that receive data.
Every fact keeps the line it came from.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .source import Token

VERBS = {
    "ACCEPT", "ADD", "ALLOCATE", "CALL", "CANCEL", "CLOSE", "COMPUTE", "CONTINUE", "DELETE", "DISPLAY", "DIVIDE", "EVALUATE", "EXEC",
    "EXIT", "FREE", "GOBACK", "GO", "IF", "INITIALIZE", "INSPECT", "INVOKE", "MERGE", "MOVE", "MULTIPLY", "OPEN", "PERFORM", "READ",
    "RELEASE", "RETURN", "REWRITE", "SEARCH", "SET", "SORT", "START", "STOP", "STRING", "SUBTRACT", "UNSTRING", "WRITE", "NEXT",
}
SCOPE_END = {"ELSE", "END-IF", "WHEN", "END-EVALUATE", "END-PERFORM"}
PHRASES = [("NOT", "AT", "END"), ("AT", "END"), ("NOT", "INVALID", "KEY"), ("INVALID", "KEY"), ("NOT", "ON", "EXCEPTION"), ("ON", "EXCEPTION"),
           ("NOT", "ON", "OVERFLOW"), ("ON", "OVERFLOW"), ("NOT", "ON", "SIZE", "ERROR"), ("ON", "SIZE", "ERROR"), ("NOT", "EXCEPTION"), ("EXCEPTION",)]
# Options of these CICS commands are all outputs (the program receives them).
CICS_OUTPUT_COMMANDS = {"ASSIGN", "INQUIRE", "ASKTIME", "FORMATTIME", "ADDRESS"}
CICS_OUTPUT_OPTIONS = {"INTO", "SET", "RESP", "RESP2", "NUMITEMS", "ITEM", "ABCODE", "COMPSTATUS", "CHANNEL"}
FIGURATIVE = {"SPACE", "SPACES", "ZERO", "ZEROS", "ZEROES", "LOW-VALUE", "LOW-VALUES", "HIGH-VALUE", "HIGH-VALUES", "QUOTE", "QUOTES", "NULL", "NULLS", "TRUE", "FALSE"}
NOT_DATA = VERBS | FIGURATIVE | {
    "TO", "FROM", "BY", "INTO", "GIVING", "OF", "IN", "AND", "OR", "NOT", "THEN", "ELSE", "END-IF", "IS", "ARE", "EQUAL", "EQUALS", "GREATER", "LESS",
    "THAN", "ROUNDED", "REMAINDER", "DELIMITED", "SIZE", "WITH", "POINTER", "ALL", "CORRESPONDING", "CORR", "FUNCTION", "LENGTH", "ADDRESS",
    "NUMERIC", "ALPHABETIC", "POSITIVE", "NEGATIVE", "OTHER", "ALSO", "THRU", "THROUGH", "UNTIL", "VARYING", "TIMES", "AFTER", "BEFORE", "TEST",
    "USING", "REFERENCE", "CONTENT", "VALUE", "RETURNING", "ON", "AT", "END", "KEY", "INVALID", "ERROR", "OVERFLOW", "EXCEPTION", "NEXT", "SENTENCE",
}


@dataclass
class Guard:
    kind: str  # if, else, when, other, loop, phrase, early_exit
    text: str
    line: int
    negated: bool = False
    end: int = 0  # the last line of the statement that sets it (an earlier exit: the whole IF, its GO TO included)

    def render(self) -> str:
        return f"NOT ({self.text})" if self.negated else self.text


@dataclass
class Stmt:
    kind: str  # a verb, or IF, EVALUATE, LOOP, EXEC
    line: int
    end: int
    tokens: list[Token]
    para: str | None = None
    then: list["Stmt"] = field(default_factory=list)
    els: list["Stmt"] = field(default_factory=list)
    branches: list[tuple[list[Token], list["Stmt"], str]] = field(default_factory=list)  # EVALUATE whens, phrases: (condition, body, kind)
    guards: list[Guard] = field(default_factory=list)
    sets: list[dict] = field(default_factory=list)  # {"field", "from": [fields or literals], "how", "line"}
    reads: list[str] = field(default_factory=list)

    def text(self, limit: int = 120) -> str:
        parts = [f"'{t.text}'" if t.kind == "literal" else t.text for t in self.tokens]
        return re.sub(r"\s+([).,:])", r"\1", re.sub(r"([(:])\s+", r"\1", " ".join(parts)))[:limit]


def _cond_text(ts: list[Token]) -> str:
    parts = [f"'{t.text}'" if t.kind == "literal" else t.text for t in ts]
    return re.sub(r"\s+([).,])", r"\1", re.sub(r"([(])\s+", r"\1", " ".join(parts)))


class Parser:
    def __init__(self, tokens: list[Token], paragraphs: set[str]):
        self.ts = tokens
        self.paragraphs = paragraphs

    def starts(self, i: int) -> bool:
        t = self.ts[i]
        return t.kind == "word" and t.upper in VERBS

    def phrase_at(self, i: int) -> tuple[str, ...] | None:
        for ph in PHRASES:
            if all(i + k < len(self.ts) and self.ts[i + k].upper == w for k, w in enumerate(ph)):
                return ph
        return None

    def seq(self, i: int, stop: set[str]) -> tuple[list[Stmt], int]:
        out: list[Stmt] = []
        while i < len(self.ts):
            t = self.ts[i]
            if t.text == "." or t.upper in stop or (t.upper in SCOPE_END and t.upper not in stop):
                return out, i
            if self.phrase_at(i):
                return out, i
            if t.upper == "IF":
                s, i = self.if_(i)
            elif t.upper == "EVALUATE":
                s, i = self.evaluate(i)
            elif t.upper == "EXEC":
                j = i
                while j < len(self.ts) and self.ts[j].upper != "END-EXEC":
                    j += 1
                s = Stmt("EXEC", t.line, self.ts[min(j, len(self.ts) - 1)].line, self.ts[i : j + 1])
                i = j + 1
            elif t.upper == "PERFORM" and self.inline_perform(i):
                s, i = self.loop(i)
            elif self.starts(i):
                s, i = self.simple(i)
            else:
                i += 1
                continue
            out.append(s)
        return out, i

    def inline_perform(self, i: int) -> bool:
        nxt = self.ts[i + 1] if i + 1 < len(self.ts) else None
        if not nxt or nxt.text == ".":
            return False
        if nxt.upper in self.paragraphs:
            return False
        return nxt.upper in ("UNTIL", "VARYING", "WITH", "TEST", "FOREVER") or nxt.text.isdigit() or self.starts(i + 1) or (i + 2 < len(self.ts) and self.ts[i + 2].upper == "TIMES")

    def header_end(self, i: int) -> int:
        """End of a condition or loop header: the first statement verb (or scope word) after it."""
        j = i
        while j < len(self.ts) and self.ts[j].text != "." and not self.starts(j) and self.ts[j].upper not in {"THEN", "NEXT"} | SCOPE_END:
            j += 1
        return j

    def if_(self, i: int) -> tuple[Stmt, int]:
        j = self.header_end(i + 1)
        s = Stmt("IF", self.ts[i].line, self.ts[max(i, j - 1)].line, self.ts[i + 1 : j])
        if j < len(self.ts) and self.ts[j].upper == "THEN":
            j += 1
        if j + 1 < len(self.ts) and self.ts[j].upper == "NEXT" and self.ts[j + 1].upper == "SENTENCE":
            j += 2
        else:
            s.then, j = self.seq(j, {"ELSE", "END-IF"})
        if j < len(self.ts) and self.ts[j].upper == "ELSE":
            if j + 2 < len(self.ts) and self.ts[j + 1].upper == "NEXT" and self.ts[j + 2].upper == "SENTENCE":
                j += 3
            else:
                s.els, j = self.seq(j + 1, {"END-IF"})
        if j < len(self.ts) and self.ts[j].upper == "END-IF":
            j += 1
        return s, j

    def evaluate(self, i: int) -> tuple[Stmt, int]:
        j = i + 1
        while j < len(self.ts) and self.ts[j].upper != "WHEN" and self.ts[j].text != ".":
            j += 1
        s = Stmt("EVALUATE", self.ts[i].line, self.ts[max(i, j - 1)].line, self.ts[i + 1 : j])
        while j < len(self.ts) and self.ts[j].upper == "WHEN":
            k = j + 1
            other = k < len(self.ts) and self.ts[k].upper == "OTHER"
            # several WHENs can share one body
            while k < len(self.ts) and not self.starts(k) and self.ts[k].text != "." and self.ts[k].upper not in ("END-EVALUATE",):
                if self.ts[k].upper == "WHEN" and k + 1 < len(self.ts) and self.starts(k + 1):
                    break
                k += 1
            cond = [t for t in self.ts[j + 1 : k] if t.upper != "WHEN"] if not other else []
            body, k = self.seq(k, {"WHEN", "END-EVALUATE"})
            s.branches.append((cond, body, "other" if other else "when"))
            j = k
        if j < len(self.ts) and self.ts[j].upper == "END-EVALUATE":
            j += 1
        return s, j

    def loop(self, i: int) -> tuple[Stmt, int]:
        j = self.header_end(i + 1)
        s = Stmt("LOOP", self.ts[i].line, self.ts[max(i, j - 1)].line, self.ts[i + 1 : j])
        s.then, j = self.seq(j, {"END-PERFORM"})
        if j < len(self.ts) and self.ts[j].upper == "END-PERFORM":
            j += 1
        return s, j

    def simple(self, i: int) -> tuple[Stmt, int]:
        verb = self.ts[i].upper
        j = i + 1
        own_end = f"END-{verb}"
        while j < len(self.ts):
            t = self.ts[j]
            if t.text == "." or t.upper in SCOPE_END or (self.starts(j) and not (verb == "GO" and t.upper == "TO")):
                break
            if t.upper == own_end:
                j += 1
                break
            ph = self.phrase_at(j)
            if ph:
                s = Stmt(verb, self.ts[i].line, self.ts[j - 1].line, self.ts[i:j])
                while ph:
                    body, k = self.seq(j + len(ph), {own_end})
                    s.branches.append((list(self.ts[j : j + len(ph)]), body, "phrase"))
                    j = k
                    ph = self.phrase_at(j) if j < len(self.ts) else None
                if j < len(self.ts) and self.ts[j].upper == own_end:
                    j += 1
                return s, j
            j += 1
        end_tok = self.ts[j - 1] if self.ts[j - 1].upper != own_end else self.ts[j - 2]
        return Stmt(verb, self.ts[i].line, end_tok.line, [t for t in self.ts[i:j] if t.upper != own_end]), j


# ── Paragraphs and their statements ─────────────────────────────────────────

@dataclass
class Paragraph:
    name: str
    kind: str  # paragraph or section
    line: int
    section: str | None
    body: list[Stmt] = field(default_factory=list)


def paragraphs_of(tokens: list[Token]) -> list[Paragraph]:
    """Split the PROCEDURE DIVISION at its headers (a name in Area A followed by '.' or SECTION '.')."""
    from .cobol import NOT_PARAGRAPH, VERBS as COBOL_VERBS

    heads = []
    start = 0
    for i, t in enumerate(tokens):
        if t.upper == "DIVISION" and i > 0 and tokens[i - 1].upper == "PROCEDURE":
            start = _sentence_after(tokens, i)
            break
    for i in range(start, len(tokens)):
        t = tokens[i]
        if t.kind != "word" or not t.area_a or t.upper in NOT_PARAGRAPH or t.upper in COBOL_VERBS:
            continue
        if i + 1 < len(tokens) and tokens[i + 1].text == ".":
            heads.append((i, i + 2, "paragraph"))
        elif i + 2 < len(tokens) and tokens[i + 1].upper == "SECTION" and tokens[i + 2].text == ".":
            heads.append((i, i + 3, "section"))
    names = {tokens[h[0]].upper for h in heads}
    out: list[Paragraph] = []
    section = None
    # Statements before the first header belong to an unnamed entry paragraph.
    first = heads[0][0] if heads else len(tokens)
    if any(t.kind == "word" for t in tokens[start:first]):
        out.append(Paragraph("(entry)", "paragraph", tokens[start].line if start < len(tokens) else 0, None, _body(tokens[start:first], names)))
    for k, (h, body_start, kind) in enumerate(heads):
        nxt = heads[k + 1][0] if k + 1 < len(heads) else len(tokens)
        name = tokens[h].upper
        if kind == "section":
            section = name
        out.append(Paragraph(name, kind, tokens[h].line, section if kind == "paragraph" else name, _body(tokens[body_start:nxt], names)))
    return out


def _sentence_after(tokens: list[Token], i: int) -> int:
    while i < len(tokens) and tokens[i].text != ".":
        i += 1
    return i + 1


def _body(tokens: list[Token], names: set[str]) -> list[Stmt]:
    p = Parser(tokens, names)
    out, i = [], 0
    while i < len(tokens):
        stmts, i = p.seq(i, set())
        out.extend(stmts)
        i += 1  # past the period (or a stray scope word)
    return out


# ── Guards ──────────────────────────────────────────────────────────────────

TRANSFER = {"GOBACK", "GO", "STOP"}


# Paragraphs and sections that never come back: PERFORM GET-ME-OUT-OF-HERE (an EXEC CICS RETURN) ends the run
# as surely as a GO TO. Set by build() for the program being built.
_ENDING: set[str] = set()


def transfers(s: Stmt) -> bool:
    """An unconditional transfer of control: GO TO, GOBACK, STOP RUN, EXIT PROGRAM, EXEC CICS RETURN/XCTL/ABEND,
    or a PERFORM of a paragraph that always ends the run."""
    if s.kind in TRANSFER:
        return True
    if s.kind == "PERFORM" and len(s.tokens) == 2 and s.tokens[1].upper in _ENDING:
        return True
    if s.kind == "EXIT" and len(s.tokens) > 1 and s.tokens[1].upper == "PROGRAM":
        return True
    if s.kind == "EXEC" and len(s.tokens) > 2 and s.tokens[1].upper == "CICS" and s.tokens[2].upper in ("RETURN", "XCTL", "ABEND"):
        return True
    return False


def ends_in_transfer(stmts: list[Stmt]) -> bool:
    if not stmts:
        return False
    last = stmts[-1]
    if transfers(last):
        return True
    if last.kind == "IF":
        return ends_in_transfer(last.then) and ends_in_transfer(last.els)
    return False


def assign_guards(stmts: list[Stmt], guards: list[Guard], para: str) -> None:
    current = list(guards)
    for s in stmts:
        s.guards = list(current)
        s.para = para
        if s.kind == "IF":
            cond = _cond_text(s.tokens)
            to = max((t.line for t in s.tokens), default=s.line)  # a condition written over several lines
            assign_guards(s.then, current + [Guard("if", cond, s.line, end=to)], para)
            assign_guards(s.els, current + [Guard("else", cond, s.line, negated=True, end=to)], para)
            # Earlier exits: every path through this IF that leaves the block (GO TO, GOBACK, CICS RETURN…), nested ones
            # included. What follows runs only when none of them was taken.
            paths = exit_paths([s], [])
            if paths:
                text = " OR ".join("(" + " AND ".join(p) + ")" if len(paths) > 1 and len(p) > 1 else " AND ".join(p) for p in paths)
                current = current + [Guard("early_exit", text, s.line, negated=True, end=last_line(s))]
        elif s.kind == "EVALUATE":
            subject = _cond_text(s.tokens)
            previous: list[str] = []
            for cond, body, kind in s.branches:
                if kind == "other":
                    g = Guard("other", " OR ".join(previous) or subject, s.line, negated=True)
                else:
                    text = _cond_text(cond)
                    text = text if subject.upper() == "TRUE" else f"{subject} = {text}"
                    previous.append(text)
                    g = Guard("when", text, cond[0].line if cond else s.line)
                assign_guards(body, current + [g], para)
        elif s.kind == "LOOP":
            assign_guards(s.then, current + [Guard("loop", "PERFORM " + _cond_text(s.tokens), s.line, end=max((t.line for t in s.tokens), default=s.line))], para)
        for cond, body, kind in s.branches if s.kind not in ("EVALUATE",) else []:
            assign_guards(body, current + [Guard("phrase", _cond_text(cond), cond[0].line if cond else s.line)], para)


def _wrapped(cond: str) -> bool:
    """Whether one pair of parentheses encloses the whole condition (not two groups side by side)."""
    if not (cond.startswith("(") and cond.endswith(")")):
        return False
    depth = 0
    for k, c in enumerate(cond):
        depth += {"(": 1, ")": -1}.get(c, 0)
        if depth == 0 and k < len(cond) - 1:
            return False
    return True


def exit_paths(stmts: list[Stmt], prefix: list[str]) -> list[list[str]]:
    """The conditions of every path through these statements that ends in a transfer of control."""
    out: list[list[str]] = []
    for s in stmts:
        if transfers(s):
            out.append(prefix or ["TRUE"])
            break
        if s.kind == "IF":
            cond = _cond_text(s.tokens)
            cond = f"({cond})" if " OR " in cond.upper() and not _wrapped(cond) else cond
            out += exit_paths(s.then, prefix + [cond])
            out += exit_paths(s.els, prefix + [f"NOT ({cond})"])
        elif s.kind == "EVALUATE":
            subject = _cond_text(s.tokens)
            for c, body, kind in s.branches:
                text = "OTHER" if kind == "other" else (_cond_text(c) if subject.upper() == "TRUE" else f"{subject} = {_cond_text(c)}")
                out += exit_paths(body, prefix + [text])
    return out


def last_line(s: Stmt) -> int:
    """The last line a statement covers, nested branches included."""
    end = s.end
    for sub in walk(s.then + s.els + [b for _, body, _ in s.branches for b in body]):
        end = max(end, sub.end)
    return end


def walk(stmts: list[Stmt]):
    for s in stmts:
        yield s
        yield from walk(s.then)
        yield from walk(s.els)
        for _, body, _ in s.branches:
            yield from walk(body)


# ── Data: what each statement sets and reads ────────────────────────────────

def _names(ts: list[Token]) -> list[str]:
    """Data names in a token run: qualifiers (X OF Y) keep X; subscripts and reference modification are read too."""
    out = []
    skip_next = False
    for k, t in enumerate(ts):
        if skip_next:
            skip_next = False
            continue
        if t.kind != "word" or t.upper in NOT_DATA or re.fullmatch(r"[+-]?\d+", t.text):
            if t.upper in ("OF", "IN"):
                skip_next = True
            continue
        out.append(t.upper)
    return out


def _split(ts: list[Token], word: str) -> tuple[list[Token], list[Token]] | None:
    for k, t in enumerate(ts):
        if t.upper == word:
            return ts[:k], ts[k + 1 :]
    return None


def data_of(s: Stmt) -> None:
    """Fill s.sets and s.reads for one statement."""
    ts = s.tokens
    v = s.kind
    sets: list[dict] = []
    reads: list[str] = []

    def put(targets: list[str], sources: list[str], how: str, literal: str | None = None):
        for t in targets:
            sets.append({"field": t, "from": sources, "how": how, "line": s.line, **({"literal": literal} if literal is not None else {})})

    if v == "MOVE" and len(ts) > 1:
        sp = _split(ts[1:], "TO")
        if sp:
            src, dst = sp
            lit = src[0].text if src and src[0].kind == "literal" else (src[0].upper if src and src[0].upper in FIGURATIVE else None)
            srcs = _names(src)
            put(_names(dst)[:1] if any(x.text == "(" for x in dst) else _targets(dst), srcs, "MOVE", lit)
            reads += srcs
    elif v == "COMPUTE":
        sp = _split(ts[1:], "=")
        if sp:
            dst, expr = sp
            srcs = _names(expr)
            put(_targets(dst), srcs, "COMPUTE")
            reads += srcs
    elif v in ("ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"):
        names = _names(ts[1:])
        give = _split(ts[1:], "GIVING")
        if give:
            put(_targets(give[1]), _names(give[0]), v)
            reads += _names(give[0])
        else:
            key = {"ADD": "TO", "SUBTRACT": "FROM", "MULTIPLY": "BY", "DIVIDE": "INTO"}[v]
            sp = _split(ts[1:], key)
            if sp:
                put(_targets(sp[1]), _names(sp[0]) + _targets(sp[1]), v)
                reads += names
    elif v == "INITIALIZE":
        put(_targets(ts[1:]), [], "INITIALIZE")
    elif v == "SET" and len(ts) > 1:
        sp = _split(ts[1:], "TO")
        if sp:
            put(_targets(sp[0]), _names(sp[1]), "SET", sp[1][0].upper if sp[1] and sp[1][0].upper in ("TRUE", "FALSE", "NULL") else None)
            reads += _names(sp[1])
    elif v == "STRING":
        sp = _split(ts[1:], "INTO")
        if sp:
            put(_targets(sp[1])[:1], _names(sp[0]), "STRING")
            reads += _names(sp[0])
    elif v == "UNSTRING":
        sp = _split(ts[1:], "INTO")
        if sp:
            put(_targets(sp[1]), _names(sp[0])[:1], "UNSTRING")
            reads += _names(sp[0])[:1]
    elif v in ("READ", "RETURN"):
        sp = _split(ts[1:], "INTO")
        if sp:
            put(_targets(sp[1])[:1], [f"file:{ts[1].upper}"], "READ")
    elif v == "ACCEPT":
        put(_targets(ts[1:])[:1], ["input"], "ACCEPT")
    elif v == "CALL":
        sp = _split(ts[1:], "USING")
        if sp:
            for a in _names(sp[1]):
                sets.append({"field": a, "from": [f"call:{_names(ts[1:2])[0] if _names(ts[1:2]) else ts[1].text}"], "how": "CALL (may set)", "line": s.line, "maybe": True})
            reads += _names(sp[1])
    elif v == "EXEC":
        sets, reads = _exec_data(s)
    elif v in ("IF", "EVALUATE", "LOOP"):
        reads += _names(ts)
    elif v in ("WRITE", "REWRITE", "DISPLAY"):
        reads += _names(ts[1:])
    s.sets, s.reads = sets, list(dict.fromkeys(reads))


def _targets(ts: list[Token]) -> list[str]:
    """Receiving fields of MOVE/COMPUTE/…: names outside parentheses (subscripts aren't targets)."""
    out, depth, skip = [], 0, False
    for t in ts:
        if t.text == "(":
            depth += 1
        elif t.text == ")":
            depth -= 1
        elif depth == 0:
            if skip:
                skip = False
                continue
            if t.upper in ("OF", "IN"):
                skip = True
                continue
            if t.kind == "word" and t.upper not in NOT_DATA and not re.fullmatch(r"[+-]?\d+", t.text):
                out.append(t.upper)
    return out


def _exec_data(s: Stmt) -> tuple[list[dict], list[str]]:
    ts = s.tokens
    kind = ts[1].upper if len(ts) > 1 else ""
    sets: list[dict] = []
    reads: list[str] = []
    body = ts[2:-1] if ts and ts[-1].upper == "END-EXEC" else ts[2:]
    if kind == "SQL":
        words = [t.upper for t in body]
        # SELECT col, col INTO :hv, :hv FROM table / FETCH cursor INTO :hv
        hosts, k = [], 0
        while k < len(body):
            if body[k].text == ":" and k + 1 < len(body):
                hosts.append((k, body[k + 1].upper))
            k += 1
        into = words.index("INTO") if "INTO" in words else -1
        frm = next((k for k in range(into + 1, len(words)) if words[k] == "FROM"), len(words)) if into >= 0 else -1
        if words and words[0] in ("SELECT", "FETCH") and into >= 0:
            outs = [h for k, h in hosts if into < k < frm] if words[0] == "SELECT" else [h for k, h in hosts if k > into]
            cols = [t.upper for t in body[1:into] if t.kind == "word" and t.upper not in ("DISTINCT", "AS")] if words[0] == "SELECT" else []
            table = body[frm + 1].upper if words[0] == "SELECT" and frm + 1 < len(body) else None
            for n, h in enumerate(outs):
                col = cols[n] if n < len(cols) else None
                sets.append({"field": h, "from": [f"db2:{table}.{col}" if table and col else "db2"], "how": "EXEC SQL " + words[0], "line": s.line})
            reads += [h for k, h in hosts if not (into < k < (frm if words[0] == "SELECT" else len(words)))]
        else:
            reads += [h for _, h in hosts]
        return sets, reads
    if kind == "CICS":
        command = body[0].upper if body else ""
        # Where data comes from: a READ names its file, a RECEIVE its map.
        named = {}
        for k2 in range(1, len(body) - 2):
            if body[k2].upper in ("FILE", "DATASET", "MAP", "MAPSET", "QUEUE", "CONTAINER") and body[k2 + 1].text == "(":
                named.setdefault(body[k2].upper, body[k2 + 2].text.upper())
        origin = next((f"{key} {named[key]}" for key in ("FILE", "DATASET", "MAP", "QUEUE", "CONTAINER") if key in named), "")
        k = 1
        while k < len(body):
            t = body[k]
            if t.kind == "word" and k + 1 < len(body) and body[k + 1].text == "(":
                depth, j = 1, k + 2
                while j < len(body) and depth:
                    depth += {"(": 1, ")": -1}.get(body[j].text, 0)
                    j += 1
                inner = body[k + 2 : j - 1]
                names = _targets(inner) or _names(inner)
                if names and (command in CICS_OUTPUT_COMMANDS or t.upper in CICS_OUTPUT_OPTIONS):
                    sets.append({"field": names[0], "from": [f"cics:{command}.{t.upper}" + (f" {origin}" if origin and t.upper == "INTO" else "")], "how": f"EXEC CICS {command} {t.upper}", "line": t.line, "runtime": True})
                else:
                    reads += names
                k = j
                continue
            k += 1
    return sets, reads


# ── The program's flow ──────────────────────────────────────────────────────

@dataclass
class Flow:
    program: str
    path: str
    paragraphs: list[Paragraph]

    def statements(self):
        for p in self.paragraphs:
            yield from walk(p.body)

    def at(self, line: int) -> Stmt | None:
        """The innermost statement starting at a line (or the one spanning it)."""
        best = None
        for s in self.statements():
            if s.line == line:
                best = s
            elif best is None and s.line <= line <= s.end and s.kind not in ("IF", "EVALUATE", "LOOP"):
                best = s
        return best

    def paragraph_of(self, s: Stmt) -> Paragraph | None:
        return next((p for p in self.paragraphs if p.name == s.para), None)

    def performs(self) -> list[tuple[Paragraph, Stmt, str, str | None]]:
        """(the paragraph holding it, the PERFORM, its target, its THRU target)."""
        out = []
        names = {p.name for p in self.paragraphs}
        for p in self.paragraphs:
            for s in walk(p.body):
                if s.kind == "PERFORM" and len(s.tokens) > 1 and s.tokens[1].upper in names:
                    thru = s.tokens[3].upper if len(s.tokens) > 3 and s.tokens[2].upper in ("THRU", "THROUGH") else None
                    out.append((p, s, s.tokens[1].upper, thru))
        return out


def ending(paras: list[Paragraph]) -> set[str]:
    """The paragraphs and sections that, once performed, never return (to a fixpoint: one that performs
    an ending one ends too). A section runs its paragraphs in order."""
    names: set[str] = set()

    def final(s: Stmt) -> bool:  # a GO TO jumps elsewhere in the program; only these leave it
        return transfers(s) and s.kind != "GO"

    def all_end(stmts: list[Stmt]) -> bool:
        return bool(stmts) and (final(stmts[-1]) or (stmts[-1].kind == "IF" and all_end(stmts[-1].then) and all_end(stmts[-1].els)))

    def ends(body: list[Stmt]) -> bool:
        return any(final(s) or (s.kind == "IF" and all_end(s.then) and all_end(s.els)) for s in body)

    global _ENDING
    _ENDING = names
    while True:
        before = len(names)
        for p in paras:
            body = p.body if p.kind == "paragraph" else [x for q in paras if q.section == p.name or q is p for x in q.body]
            if p.name not in names and ends(body):
                names.add(p.name)
        if len(names) == before:
            return names


def build(prog) -> Flow:
    paras = paragraphs_of(prog.proc_tokens)
    ending(paras)
    for p in paras:
        assign_guards(p.body, [], p.name)
        for s in walk(p.body):
            data_of(s)
    return Flow(prog.name, prog.path, paras)
