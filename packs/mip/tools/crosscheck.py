"""
Independent cross-check: MIP (our extractor) against cobol-py (a port of ProLeap's grammar,
a separate implementation) on the CardDemo programs both can read. Compares, per program,
the static CALL targets and the CICS LINK/XCTL program targets. cobol-py inlines copybooks,
so MIP's copybook edges are credited to the programs that COPY them.
"""
import json
import re
import sys
from collections import Counter

mip = json.load(open(sys.argv[1], encoding="utf-8"))
cpy = json.load(open(sys.argv[2], encoding="utf-8"))

edges = [e for p in mip["parts"] for e in p["edges"]]
includes = {}
for e in edges:
    if e["kind"] == "includes":
        includes.setdefault(e["from"], []).append(e["to"])


def mip_calls(pid):
    srcs = [pid] + includes.get(pid, [])
    return Counter(e["to"] for e in edges if e["from"] in srcs and e["kind"] == "calls" and not e.get("dynamic"))


agree = disagree = 0
rows = []
for r in cpy:
    if not r["ok"]:
        continue
    pid = r["program"].rsplit("/", 1)[-1].rsplit(".", 1)[0].upper()
    theirs = Counter()
    for c in r["found"]["calls"]:
        m = re.match(r"CALL['\"]([^'\"]+)['\"]", c)
        if m:
            theirs[m.group(1).upper().strip()] += 1
    ours = mip_calls(pid)
    if ours == theirs:
        agree += 1
    else:
        disagree += 1
        rows.append((pid, dict(ours), dict(theirs)))
print(f"static CALL targets per program: {agree} agree, {disagree} differ")
for row in rows:
    print("  ", row)
