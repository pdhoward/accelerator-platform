# MIP: the Mainframe Intelligence Pack

The Accelerator's technology pack for the mainframe family (COBOL, JCL, CICS, DB2, IMS, VSAM). It reads a repository's source, never runs anything from it, and writes the platform's code map (`packages/domain/src/code-map.ts`): units, entry points, data stores and edges, every one cited to a file and line. Design, decisions and the benchmark: `accelerator/work/mip.md`.

Stage: **P2, resolution and interface checks** (2026-11-12), on top of P1's L2 structure.

## Run

```sh
cd packs/mip
python -m venv .venv
.venv/Scripts/python -m pip install --only-binary :all: -r requirements.lock   # Windows; .venv/bin/python elsewhere
PYTHONPATH=src .venv/Scripts/python -m mip analyze <repo> --out map.json
PYTHONPATH=src .venv/Scripts/python -m mip.bench map.json <expected.json>
PYTHONPATH=src .venv/Scripts/python -m unittest discover -s tests
```

`analyze` lists files with `git ls-files` (or `--files list.txt`, one path per line, which is how the runner calls it).

## What it reads

| Module | Reads |
|---|---|
| `source.py` | Fixed and free format, comment and debug lines, continuations, free-text identification entries; every token keeps its original line and column |
| `cobol.py` | PROGRAM-ID, sections and paragraphs, PERFORM and THRU, GO TO, static and dynamic CALL, COPY and REPLACING, data items (VALUE, REDEFINES, OCCURS, USAGE), SELECT and FD, file I/O; EXEC blocks cut out first |
| `embedded.py` | EXEC CICS (every command and option; dynamic targets resolved by VALUE and MOVE), EXEC SQL (tables through SQLGlot; cursors), IMS DL/I (EXEC DLI and CALL 'CBLTDLI' with function codes and segments from SSAs) |
| `jcl.py` | JCL (jobs, steps, PGM and PROC, DD and DSN with disposition, in-stream `DSN RUN PROGRAM`), CICS CSD (transactions, files), BMS mapsets |
| `analyze.py` | Builds the code map: one part per technology (cobol, cics, db2, ims, jcl) plus diagnostics |
| `layout.py` | Byte sizes and offsets from PICTURE and USAGE (Enterprise COBOL rules), groups, OCCURS, REDEFINES, COPY expanded in place (REPLACING applied); tables read the way the program reads them |
| `interfaces.py` | Every CICS LINK/XCTL with a COMMAREA compared byte for byte with what the called program reads: same, compatible, not read, or differs (high/low by whether the called program uses the conflicting fields) |
| `bench.py` | Scores a map against a golden expected-results manifest (P1 categories and P2 checks) |

Dynamic targets are never guessed: a target held in data is marked `dynamic`, with the literal values the source assigns to it, and stays unresolved when there are none (a menu table, a CSD transaction).

## P1 results (2026-11-12)

- **IBM Bank of Z** (pinned `568421969f86`): 100% recall and 100% precision in all 8 categories of the golden file (108 LINKs, 20 RETURN TRANSIDs, 89 COPYs, 29 SQL accesses, 3 batch steps, 1 asynchronous RUN, calls, CICS file I/O); the asynchronous RUN's programs left unresolved, as required. 0.37 s.
- **CardDemo:** 32 XCTL (30 through data), 26 EXEC DLI and 9 CBLTDLI, 11 programs with indexed (VSAM) files, 52 CICS file commands, 159 JCL steps, 25 CSD transactions; 0 diagnostics; 0.43 s. Static CALL targets agree with cobol-py (an independent grammar, ProLeap's) on all 39 programs it can parse.

## P2 results (2026-11-12)

- **Resolution:** CardDemo's menus resolve to the programs in their tables (COMEN01C: 11, COADM01C: 6, read from COMEN02Y/COADM02Y the way the program reads them); Bank of Z's asynchronous RUN resolves to OCR1–OCR5 by evaluating `STRING 'OCR' WS-CC-CNT` inside its `PERFORM VARYING` (the programs those transactions run stay unresolved: no CSD in the repository).
- **Interfaces:** Bank of Z, 145 checked: the **BNK1CRA → DBCRFUN** drift found automatically (high: DBCRFUN uses COMM-DESCRIPTION, COMM-SUCCESS and COMM-FAIL-CODE at 90–131; BNK1CRA passes 92 bytes) and **DELCUS → DELACC** (low: a PCB pointer DELACC never uses). CardDemo, 68 checked: no drift (screens extend the shared COMMAREA with a bounded copy; the sign-on never reads its COMMAREA).
- All P1 scores unchanged; 22 unit tests.
