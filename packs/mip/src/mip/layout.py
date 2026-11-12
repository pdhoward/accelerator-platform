"""
Storage layout (P2): the byte size and offset of every data item, so that what one program
passes another can be compared byte for byte, and a table built from VALUE literals can be
read the way the program reads it.

Sizes follow IBM Enterprise COBOL: DISPLAY one byte per picture position (S and V take none
unless SIGN SEPARATE); BINARY/COMP/COMP-4/COMP-5 2, 4 or 8 bytes by digits; PACKED-DECIMAL/
COMP-3 (digits + 1) / 2 rounded up; COMP-1 4, COMP-2 8; POINTER and INDEX 4 (31-bit).
A group is the sum of its children; OCCURS multiplies; REDEFINES adds nothing to its parent.
COPY markers are expanded in place from the copybook's own items.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .cobol import DataItem, Program


def _expand_pic(pic: str) -> str:
    return re.sub(r"(.)\((\d+)\)", lambda m: m.group(1) * int(m.group(2)), pic.upper())


def elementary_size(item: DataItem, usage: str | None) -> int:
    if usage in ("POINTER", "PROCEDURE-POINTER", "FUNCTION-POINTER", "INDEX"):
        return 4 if usage != "PROCEDURE-POINTER" else 8
    if usage == "COMP-1":
        return 4
    if usage == "COMP-2":
        return 8
    if not item.pic:
        return 0
    p = _expand_pic(item.pic)
    digits = sum(1 for c in p if c in "9P")
    if usage in ("COMP", "COMP-5"):
        return 2 if digits <= 4 else 4 if digits <= 9 else 8
    if usage == "COMP-3":
        return digits // 2 + 1
    # DISPLAY (and edited pictures): every position is a byte, except S (unless separate), V and P.
    n = 0
    k = 0
    while k < len(p):
        if p.startswith(("CR", "DB"), k):
            n += 2
            k += 2
            continue
        c = p[k]
        if c == "S":
            n += 1 if item.sign_separate else 0
        elif c in "VP":
            pass
        else:
            n += 2 if usage == "NATIONAL" else 1
        k += 1
    return n


@dataclass
class Node:
    """A data item with its storage: offset within its 01 record, size, and its children laid out."""

    item: DataItem
    offset: int
    size: int  # one occurrence
    occurs: int
    children: list["Node"] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.size * self.occurs


class Layout:
    """Lays out a program's records, expanding COPY markers from the copybooks it can see."""

    def __init__(self, prog: Program, copybooks: dict[str, Program]):
        self.prog = prog
        self.copybooks = copybooks

    def _expand(self, items: list[DataItem], depth: int = 0, within: int = 0) -> list[DataItem]:
        """Children with COPY markers replaced by the copybook's items. Copied 01 and 77 items are records of their
        own, never children of the record above the COPY (BNK1DAC copies INQACC's 01 record after PARMS-SUBPGM)."""
        out = []
        for it in items:
            if it.copy:
                cp = self.copybooks.get(it.copy)
                if cp and depth < 8:
                    out.extend(x for x in self._expand(cp.roots, depth + 1, within) if not (within and x.level in (1, 77)))
            else:
                out.append(it)
        return out

    def node(self, item: DataItem, offset: int = 0, usage: str | None = None, depth: int = 0) -> Node:
        usage = item.usage or usage
        occurs = item.occurs or 1
        own = item.extends.children + item.children if item.extends else item.children
        kids = [k for k in self._expand(own, within=item.level or 1) if k.level not in (66, 88)]
        if not kids:
            return Node(item, offset, elementary_size(item, usage), occurs)
        n = Node(item, offset, 0, occurs)
        pos = offset
        placed: dict[str, Node] = {}
        for k in kids:
            if k.redefines and k.redefines in placed:
                child = self.node(k, placed[k.redefines].offset, usage, depth + 1)
                n.children.append(child)
                continue
            child = self.node(k, pos, usage, depth + 1)
            n.children.append(child)
            placed[k.name] = child
            pos += child.total
        n.size = pos - offset
        return n

    def find(self, name: str) -> DataItem | None:
        """A record or field by name: in the program, else in a copybook it copies, under the name
        COPY … REPLACING gives it here (INQACC: COPY INQACC REPLACING INQACC-COMMAREA BY DFHCOMMAREA)."""
        name = name.upper()
        if name in self.prog.data:
            return self.prog.data[name]
        for c in self.prog.copies:
            cp = self.copybooks.get(c["copybook"])
            if cp and name in cp.data:
                return cp.data[name]
        for marker in (m for m in self.prog.items if m.copy and m.values):
            cp = self.copybooks.get(marker.copy)
            if not cp:
                continue
            for pair in marker.values:
                old, _, new = pair.partition("=>")
                if new and new in name:
                    original = name.replace(new, old)
                    if original in cp.data:
                        return cp.data[original]
        return None


def flatten(n: Node, prefix: str = "") -> list[dict]:
    """Elementary fields of a laid-out record: name, offset (from the record's start), size, picture, line."""
    if not n.children:
        return [{"name": n.item.name, "offset": n.offset, "size": n.total, "pic": n.item.pic, "line": n.item.line, "file": n.item.path}]
    out = []
    for c in n.children:
        if c.item.redefines:
            continue  # one view of the storage is enough to compare boundaries
        out.extend(flatten(c))
    return out


def relative(fields: list[dict], base: int) -> list[dict]:
    return [{**f, "offset": f["offset"] - base} for f in fields]


# ── Tables read the way the program reads them ─────────────────────────────

def _bytes_of(item: DataItem, size: int) -> str:
    """The storage a VALUE gives an elementary item, as text: alphanumeric left-justified, numeric right-justified."""
    if not item.values:
        return " " * size
    v = item.values[0]
    if v in ("SPACE", "SPACES"):
        return " " * size
    if v in ("ZERO", "ZEROS", "ZEROES"):
        return "0" * size
    if item.pic and re.match(r"^S?9", _expand_pic(item.pic)) and re.match(r"^[+-]?\d+$", v):
        return v.lstrip("+-").rjust(size, "0")[-size:]
    return v.ljust(size)[:size]


def _image(lay: Layout, node: Node) -> str:
    """The bytes a group's VALUE clauses produce (DISPLAY items; others as blanks of the right size)."""
    if not node.children:
        return _bytes_of(node.item, node.size) * node.occurs
    return "".join(_image(lay, c) for c in node.children if not c.item.redefines) * node.occurs


def table_values(lay: Layout, name: str) -> list[dict]:
    """The values a field inside an OCCURS table takes, when the table REDEFINES a group set by VALUE clauses
    (CardDemo's menu: CDEMO-MENU-OPT-PGMNAME OCCURS within CDEMO-MENU-OPTIONS REDEFINES CDEMO-MENU-OPTIONS-DATA)."""
    target = lay.find(name)
    if not target:
        return []
    # Find the 01 record that holds it, laid out.
    owner = _owner_program(lay, target)
    root = next((r for r in owner.roots if _contains(lay, r, target)), None)
    if not root:
        return []
    rec = Layout(owner, lay.copybooks).node(root)
    path = _path(rec, target)
    if not path:
        return []
    # The table: the nearest ancestor that REDEFINES something; the occurrence: the OCCURS ancestor below it.
    red = next((p for p in reversed(path) if p.item.redefines), None)
    occ = next((p for p in reversed(path) if p.item.occurs and p.item.occurs > 1), None)
    if not red or not occ:
        return []
    parent = path[path.index(red) - 1] if path.index(red) > 0 else None
    source = next((c for c in (parent.children if parent else []) if c.item.name == red.item.redefines), None)
    if not source:
        return []
    image = _image(lay, source)
    leaf = path[-1]
    out = []
    for k in range(occ.occurs):
        start = leaf.offset - source.offset + k * occ.size
        chunk = image[start : start + leaf.size]
        if len(chunk) < leaf.size or not chunk.strip():
            continue
        out.append({"value": chunk.strip(), "occurrence": k + 1, "line": target.line, "file": target.path, "how": "TABLE"})
    return out


def _owner_program(lay: Layout, item: DataItem) -> Program:
    if item.path == lay.prog.path:
        return lay.prog
    for cp in lay.copybooks.values():
        if cp.path == item.path:
            return cp
    return lay.prog


def _contains(lay: Layout, root: DataItem, target: DataItem) -> bool:
    if root is target:
        return True
    return any(_contains(lay, c, target) for c in lay._expand(root.children))


def _path(n: Node, target: DataItem) -> list[Node] | None:
    if n.item is target:
        return [n]
    for c in n.children:
        p = _path(c, target)
        if p:
            return [n] + p
    return None
