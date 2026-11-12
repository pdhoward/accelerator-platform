# MIP: the Mainframe Intelligence Pack

The Accelerator's technology pack for the mainframe family (COBOL, JCL, CICS, DB2, IMS, VSAM). It reads a repository's source, never runs anything from it, and writes the platform's code map (`packages/domain/src/code-map.ts`): units, entry points, data stores and edges, every one cited to a file and line. Design, decisions and the benchmark: `accelerator/work/mip.md`.

Stage: **P1, L2 structure** (2026-11-12).

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
| `bench.py` | Scores a map against a golden expected-results manifest |

Dynamic targets are never guessed: a target held in data is marked `dynamic`, with the literal values the source assigns to it, and stays unresolved when there are none (a menu table, a CSD transaction).

## P1 results (2026-11-12)

- **IBM Bank of Z** (pinned `568421969f86`): 100% recall and 100% precision in all 8 categories of the golden file (108 LINKs, 20 RETURN TRANSIDs, 89 COPYs, 29 SQL accesses, 3 batch steps, 1 asynchronous RUN, calls, CICS file I/O); the asynchronous RUN's programs left unresolved, as required. 0.37 s.
- **CardDemo:** 32 XCTL (30 through data), 26 EXEC DLI and 9 CBLTDLI, 11 programs with indexed (VSAM) files, 52 CICS file commands, 159 JCL steps, 25 CSD transactions; 0 diagnostics; 0.43 s. Static CALL targets agree with cobol-py (an independent grammar, ProLeap's) on all 39 programs it can parse.
