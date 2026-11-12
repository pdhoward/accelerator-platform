# MIP: the Mainframe Intelligence Pack

The Accelerator's technology pack for the mainframe family (COBOL, JCL, CICS, DB2, IMS, VSAM). It reads a repository's source, never runs anything from it, and writes the platform's code map (`packages/domain/src/code-map.ts`): units, entry points, data stores and edges, every one cited to a file and line. Design, decisions and the benchmark: `accelerator/work/mip.md`.

Stage: **P4, rules** (2026-11-12): candidate business rules with their evidence, reviewed by the model on the runner, on top of P3 (control flow, conditions, data flow, traces), P2 (resolution, interfaces) and P1 (L2 structure). Native: no third-party COBOL parser (SQLGlot reads embedded SQL).

## Run

```sh
cd packs/mip
python -m venv .venv
.venv/Scripts/python -m pip install --only-binary :all: -r requirements.lock   # Windows; .venv/bin/python elsewhere
PYTHONPATH=src .venv/Scripts/python -m mip analyze <repo> --out map.json
PYTHONPATH=src .venv/Scripts/python -m mip.bench map.json <expected.json>
PYTHONPATH=src .venv/Scripts/python -m mip.trace <repo> <PROGRAM> <line> [--json t.json]   # applies when / reached from / decided by
PYTHONPATH=src .venv/Scripts/python -m mip.bench --p3 <expected.json> t1.json t2.json        # golden trace coverage
PYTHONPATH=src .venv/Scripts/python -m mip.rules <repo> [--programs A,B] --out candidates.json   # rule candidates with evidence
PYTHONPATH=src .venv/Scripts/python -m mip.bench --p4 <expected.json> candidates.json        # golden rules found
# the model's review (runner): pnpm exec dotenv -e <env file> -- tsx src/mip.ts candidates.json --pack <id> --out reviews.json
PYTHONPATH=src .venv/Scripts/python -m unittest discover -s tests
```

`analyze` lists files with `git ls-files` (or `--files list.txt`, one path per line, which is how the runner calls it).

## What it reads

| Module | Reads |
|---|---|
| `source.py` | Fixed and free format, comment and debug lines, continuations, free-text identification entries; every token keeps its original line and column |
| `cobol.py` | PROGRAM-ID, sections and paragraphs, PERFORM and THRU, GO TO, static and dynamic CALL, COPY and REPLACING, data items (VALUE, REDEFINES, OCCURS, USAGE), SELECT and FD, file I/O; EXEC blocks cut out first |
| `embedded.py` | EXEC CICS (every command and option; dynamic targets resolved by VALUE and MOVE), EXEC SQL (tables through SQLGlot; cursors), IMS DL/I (EXEC DLI and CALL 'CBLTDLI' with function codes and segments from SSAs) |
| `jcl.py` | JCL (jobs, steps, PGM and PROC, DD and DSN with disposition, in-stream `DSN RUN PROGRAM`), CICS CSD and the resource builder's YAML definitions (transactions, files), BMS mapsets |
| `analyze.py` | Builds the code map: one part per technology (cobol, cics, db2, ims, jcl) plus diagnostics |
| `layout.py` | Byte sizes and offsets from PICTURE and USAGE (Enterprise COBOL rules), groups, OCCURS, REDEFINES, COPY expanded in place (REPLACING applied); tables read the way the program reads them |
| `interfaces.py` | Every CICS LINK/XCTL with a COMMAREA compared byte for byte with what the called program reads: same, compatible, not read, or differs (high/low by whether the called program uses the conflicting fields) |
| `flow.py` | The PROCEDURE DIVISION as a statement tree (IF/ELSE, EVALUATE/WHEN, inline PERFORM, AT END and similar phrases, EXEC blocks), the guards each statement runs under (earlier exits included, nested ones too), sections and paragraphs, and what each statement sets and reads (SQL INTO column by column, CICS outputs) |
| `trace.py` | One statement traced: applies when, reached from (PERFORM chains and calling programs), decided by (lineage across programs through the COMMAREA by byte offset, through 88-levels and groups), outcome (where the calling program reads it), and the review queue where static analysis stops |
| `rules.py` | Rule candidates: blocks that set what the caller receives under a business condition (technical-only conditions and loop controls excluded), THEN and ELSE together, each with its trace, the lineage of its outcome's value, its review items and the cited source lines |
| `bench.py` | Scores a map against a golden expected-results manifest (P1 categories, P2 checks, P3 golden-trace coverage) |

Dynamic targets are never guessed: a target held in data is marked `dynamic`, with the literal values the source assigns to it, and stays unresolved when there are none (a menu table, a CSD transaction).

## P1 results (2026-11-12)

- **IBM Bank of Z** (pinned `568421969f86`): 100% recall and 100% precision in all 8 categories of the golden file (108 LINKs, 20 RETURN TRANSIDs, 89 COPYs, 29 SQL accesses, 3 batch steps, 1 asynchronous RUN, calls, CICS file I/O); the asynchronous RUN's programs left unresolved, as required. 0.37 s.
- **CardDemo:** 32 XCTL (30 through data), 26 EXEC DLI and 9 CBLTDLI, 11 programs with indexed (VSAM) files, 52 CICS file commands, 159 JCL steps, 25 CSD transactions; 0 diagnostics; 0.43 s. Static CALL targets agree with cobol-py (an independent grammar, ProLeap's) on all 39 programs it can parse.

## P2 results (2026-11-12)

- **Resolution:** CardDemo's menus resolve to the programs in their tables (COMEN01C: 11, COADM01C: 6, read from COMEN02Y/COADM02Y the way the program reads them); Bank of Z's asynchronous RUN resolves to OCR1–OCR5 by evaluating `STRING 'OCR' WS-CC-CNT` inside its `PERFORM VARYING` (the programs those transactions run stay unresolved: no CSD in the repository).
- **Interfaces:** Bank of Z, 145 checked: the **BNK1CRA → DBCRFUN** drift found automatically (high: DBCRFUN uses COMM-DESCRIPTION, COMM-SUCCESS and COMM-FAIL-CODE at 90–131; BNK1CRA passes 92 bytes) and **DELCUS → DELACC** (low: a PCB pointer DELACC never uses). CardDemo, 68 checked: no drift (screens extend the shared COMMAREA with a bounded copy; the sign-on never reads its COMMAREA).
- All P1 scores unchanged; 22 unit tests.

## P3 results (2026-11-12)

- **The golden trace, reproduced automatically:** `mip.trace` on DBCRFUN 347 (the refusal) and 392 (the success update) cites **21 of 21** lines of the 9-step golden trace in `accelerator/work/mip/bank-of-z.expected.json`: the teller's amount and sign in BNK1CRA, the facility type from CICS, the LINK and the COMMAREA, the DB2 read column by column, the MORTGAGE/LOAN and insufficient-funds guards, the update and PROCTRAN, and the message the teller sees.
- **Honest stops:** the review queue names the facility type (set at run time by CICS INQUIRE) and the fail code BNK1CRA reads by intent but not by position (the P2 drift).
- **CardDemo sign-on:** "only admins reach COADM01C" is derived from the source: `CDEMO-USRTYP-ADMIN` (88 VALUE 'A', COCOM01Y) ← `MOVE SEC-USR-TYPE` (COSGN00C 227, after a good read and a matching password) ← `READ DATASET(WS-USRSEC-FILE)` (211), reached from MAIN-PARA → PROCESS-ENTER-KEY when Enter is pressed. Nothing to review.
- Both corpora parse whole: 18,298 statements, no errors, about 0.6 s each. 28 unit tests.

## P4 results (2026-11-12)

- **Golden rules:** BOZ-R1, R2 and R3 found with every decision line cited (3 of 3): DBCRFUN 346; CREACC 382, followed into INQACCCU through the LINK's COMMAREA; CRECUST 776, followed into all five credit agencies through RUN TRANSID and their PUT CONTAINER.
- **Candidates:** Bank of Z 51, CardDemo 139.
- **The model's review** (runner, Claude Opus 5.5): all 51 Bank of Z candidates for $4.38, and all 21 review items answered (8 by a proposal, 13 for a person).
- **The reader, made more exact:**
  - a PERFORM of a paragraph that never returns is an earlier exit;
  - a LINK defines its COMMAREA;
  - a loop's later definitions reach;
  - main-path definitions come before error paths;
  - an XCTL returns nothing;
  - interface review items appear only where P2 found drift.
- 35 unit tests.
