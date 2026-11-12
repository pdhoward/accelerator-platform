"""
Reading COBOL source as written (mip.md §9, P1): fixed or free format, comment and debug
lines dropped, continuation lines joined, and every token keeping the line and column it
came from in the original file. Nothing here expands copybooks: each file is analyzed as
itself, so every citation is a line of the file the steward can open.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Token:
    text: str
    line: int  # 1-based, in the original file
    col: int  # 1-based, in the original line
    kind: str  # "word", "literal", "pseudo" (==text==), "punct"

    @property
    def upper(self) -> str:
        return self.text.upper()

    @property
    def area_a(self) -> bool:
        """Starts in Area A (columns 8-11, fixed format): where division, section and paragraph names begin."""
        return 8 <= self.col <= 11


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def is_free_format(lines: list[str]) -> bool:
    return any(re.search(r">>\s*SOURCE\s+(FORMAT\s+(IS\s+)?)?FREE", l, re.I) for l in lines[:50])


@dataclass(frozen=True)
class CodeLine:
    line: int
    col0: int  # column of the first character of `text` in the original line
    text: str
    continuation: bool


def code_lines(text: str) -> list[CodeLine]:
    """The code area of every non-comment line, with its original line number."""
    lines = text.splitlines()
    out: list[CodeLine] = []
    if is_free_format(lines):
        for n, raw in enumerate(lines, 1):
            s = raw.rstrip()
            if not s.strip() or s.lstrip().startswith("*>") or s.lstrip().startswith(">>"):
                continue
            out.append(CodeLine(n, 1, re.sub(r"\*>.*$", "", s), False))
        return out
    for n, raw in enumerate(lines, 1):
        raw = raw.replace("\t", "    ")
        if len(raw) < 7:
            continue
        ind = raw[6]
        if ind in "*/":
            continue
        if ind in "Dd":  # debugging lines: compiled only WITH DEBUGGING MODE
            continue
        body = raw[7:72]
        if not body.strip():
            continue
        out.append(CodeLine(n, 8, body, ind == "-"))
    return out


_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9_#@$-]*|[A-Za-z0-9]")
_PUNCT = re.compile(r"==|>=|<=|<>|\*\*|[().,;:+\-*/=<>&]")


_COMMENT_ENTRY = re.compile(r"^\s{0,3}(AUTHOR|INSTALLATION|DATE-WRITTEN|DATE-COMPILED|SECURITY|REMARKS)\s*\.", re.I)


def _without_comment_entries(lines: list[CodeLine]) -> list[CodeLine]:
    """Drop the free text of AUTHOR, INSTALLATION, DATE-WRITTEN… (an apostrophe in a name must not open a literal).
    The entry runs to the next line that starts in Area A."""
    out, skipping = [], False
    for cl in lines:
        m = _COMMENT_ENTRY.match(cl.text)
        if m:
            out.append(CodeLine(cl.line, cl.col0, cl.text[: m.end()], False))
            skipping = True
            continue
        if skipping:
            if cl.text[:4].strip() and not cl.continuation:
                skipping = False
            else:
                continue
        out.append(cl)
    return out


def tokenize(text: str) -> list[Token]:
    """Tokens of the whole file, comments excluded, continuations joined (a literal continued
    on the next line is one token, cited at the line where it starts)."""
    tokens: list[Token] = []
    open_literal: tuple[str, int, int, str] | None = None  # (quote, line, col, text so far)
    lines = _without_comment_entries(code_lines(text))
    for idx, cl in enumerate(lines):
        if open_literal and not cl.continuation:
            # A literal can't span lines without a continuation: close it at the end of its line.
            q, ln, col, acc = open_literal
            tokens.append(Token(acc, ln, col, "literal"))
            open_literal = None
        s = cl.text
        i = 0
        if cl.continuation:
            stripped = s.lstrip()
            i = len(s) - len(stripped)
            if open_literal and stripped[:1] in ("'", '"'):
                i += 1  # the continued literal resumes after the quote in Area B
            elif tokens and tokens[-1].kind == "word" and not open_literal:
                # a word split across lines: join it to the previous token
                m = _WORD.match(s, i)
                if m:
                    last = tokens.pop()
                    tokens.append(Token(last.text + m.group(0), last.line, last.col, "word"))
                    i = m.end()
        while i < len(s):
            if open_literal:
                q, ln, col, acc = open_literal
                j = s.find(q, i)
                while j != -1 and j + 1 < len(s) and s[j + 1] == q:  # doubled quote inside a literal
                    j = s.find(q, j + 2)
                if j == -1:
                    open_literal = (q, ln, col, acc + s[i:].rstrip())
                    break
                tokens.append(Token(acc + s[i:j], ln, col, "literal"))
                open_literal = None
                i = j + 1
                continue
            c = s[i]
            if c.isspace():
                i += 1
                continue
            if c in ("'", '"'):
                open_literal = (c, cl.line, cl.col0 + i, "")
                i += 1
                continue
            if s.startswith("==", i):
                j = s.find("==", i + 2)
                if j != -1:
                    tokens.append(Token(s[i + 2 : j].strip(), cl.line, cl.col0 + i, "pseudo"))
                    i = j + 2
                    continue
            m = _WORD.match(s, i)
            if m:
                w = m.group(0)
                # a period that ends a sentence isn't part of the word
                tokens.append(Token(w, cl.line, cl.col0 + i, "word"))
                i = m.end()
                continue
            m = _PUNCT.match(s, i)
            if m:
                tokens.append(Token(m.group(0), cl.line, cl.col0 + i, "punct"))
                i = m.end()
                continue
            i += 1  # anything else (stray characters) is skipped
    if open_literal:
        q, ln, col, acc = open_literal
        tokens.append(Token(acc, ln, col, "literal"))
    return tokens


