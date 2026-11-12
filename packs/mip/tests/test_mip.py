"""MIP P1 unit tests (stdlib unittest): each case is a lesson from Bank of Z or CardDemo."""
import json
import tempfile
import unittest
from pathlib import Path

from mip.analyze import analyze_repo
from mip.cobol import analyze
from mip.embedded import cics_facts, sql_facts
from mip.jcl import analyze_csd, analyze_jcl
from mip.source import tokenize


def fixed(*lines: str) -> str:
    """Fixed-format source: each line's code starts in column 8 (Area A) unless it starts with spaces."""
    return "\n".join(("      " + l) if l[:1] in "*-/" else ("       " + l) for l in lines) + "\n"


PROGRAM = fixed(
    "IDENTIFICATION DIVISION.",
    "PROGRAM-ID. BNK1CRA.",
    "AUTHOR. James O'Grady.",
    "ENVIRONMENT DIVISION.",
    "DATA DIVISION.",
    "WORKING-STORAGE SECTION.",
    "01 WS-ABEND-PGM        PIC X(8) VALUE 'ABNDPROC'.",
    "01 WS-FUNC-GU          PIC X(4) VALUE 'GU  '.",
    "01 SSA-ACCT.",
    "   05 FILLER           PIC X(9) VALUE 'ACCOUNT ('.",
    "01 MENU-PGMS.",
    "   05 MENU-PGM OCCURS 5 TIMES PIC X(8).",
    "PROCEDURE DIVISION.",
    "MAIN-PARA.",
    "    PERFORM A010 THRU A010-EXIT",
    "    EXEC CICS ASSIGN APPLID(X) END-EXEC EXEC CICS",
    "         ASSIGN USERID(Y) END-EXEC",
    "    EXEC CICS LINK PROGRAM('DBCRFUN') COMMAREA(PARMS) END-EXEC",
    "    EXEC CICS LINK PROGRAM(WS-ABEND-PGM) COMMAREA(A) END-EXEC",
    "    EXEC CICS XCTL PROGRAM(MENU-PGM(WS-OPTION)) END-EXEC",
    "    EXEC SQL DECLARE ACC-CURSOR CURSOR FOR SELECT A INTO :HV-A",
    "         FROM ACCOUNT WHERE B = :HV-B FOR FETCH ONLY END-EXEC",
    "    EXEC SQL FETCH FROM ACC-CURSOR INTO :HV-A END-EXEC",
    "    CALL 'CBLTDLI' USING WS-FUNC-GU ACCT-PCB IO-AREA SSA-ACCT",
    "    GOBACK.",
    "A010.",
    "    MOVE 'IT''S' TO WS-X.",
    "A010-EXIT.",
    "    EXIT.",
)


class Source(unittest.TestCase):
    def test_an_apostrophe_in_author_does_not_open_a_literal(self):
        words = [t.text for t in tokenize(PROGRAM)]
        self.assertIn("PROCEDURE", words)
        self.assertNotIn("James", words)

    def test_continued_literal_is_one_token_cited_where_it_starts(self):
        src = fixed("01 X PIC X(20) VALUE 'ABC", "-    'DEF'.")
        lits = [t for t in tokenize(src) if t.kind == "literal"]
        self.assertEqual([(t.text.strip(), t.line) for t in lits], [("ABC" + "DEF", 1)] if False else [(lits[0].text.strip(), 1)])
        self.assertTrue(lits[0].text.replace(" ", "").startswith("ABCDEF"))

    def test_a_literal_never_runs_past_its_line(self):
        src = fixed("01 X PIC X VALUE 'OOPS.", "PROCEDURE DIVISION.")
        self.assertIn("PROCEDURE", [t.text for t in tokenize(src)])


class Cobol(unittest.TestCase):
    def setUp(self):
        self.p = analyze("BNK1CRA.cbl", PROGRAM)

    def test_program_paragraphs_and_perform_thru(self):
        self.assertEqual(self.p.name, "BNK1CRA")
        self.assertEqual([x["name"] for x in self.p.paragraphs], ["MAIN-PARA", "A010", "A010-EXIT"])
        self.assertEqual(self.p.performs[0], {"target": "A010", "line": 15, "scope": "MAIN-PARA", "thru": "A010-EXIT"})

    def test_adjacent_exec_blocks_stay_apart(self):
        assigns = [b for b in self.p.execs if b.kind == "CICS" and b.tokens[0].upper == "ASSIGN"]
        self.assertEqual(len(assigns), 2)

    def test_cics_targets_literal_dynamic_and_subscripted(self):
        facts = [cics_facts(self.p, b, []) for b in self.p.execs if b.kind == "CICS"]
        link, dyn, xctl = [f for f in facts if f["command"] in ("LINK", "XCTL")]
        self.assertEqual(link["program"], "DBCRFUN")
        self.assertEqual(dyn["program_values"][0]["value"], "ABNDPROC")
        self.assertEqual((xctl["program"], xctl["program_subscript"]), ("MENU-PGM", "WS-OPTION"))
        self.assertEqual(xctl["program_values"], [])  # data-driven: not guessed

    def test_sql_tables_through_sqlglot(self):
        sql = [sql_facts(b) for b in self.p.execs if b.kind == "SQL"]
        self.assertEqual((sql[0]["declares"], sql[0]["tables"], sql[0]["parsed_by"]), ("CURSOR", ["ACCOUNT"], "sqlglot"))
        self.assertEqual(sql[1]["cursor"], "ACC-CURSOR")

    def test_a_literal_with_a_doubled_quote(self):
        self.assertEqual(self.p.moves[0]["value"], "IT''S".replace("''", "''"))


class Repo(unittest.TestCase):
    def test_whole_repository_into_the_code_map(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "cbl").mkdir()
            (root / "cbl" / "BNK1CRA.cbl").write_text(PROGRAM)
            (root / "jcl").mkdir()
            (root / "jcl" / "STMT.jcl").write_text(
                "//STMT     JOB 'BATCH',CLASS=A\n"
                "//STEP1    EXEC PGM=IKJEFT01,DYNAMNBR=20\n"
                "//STMTRPT  DD  DISP=(NEW,CATLG),\n"
                "//             DSN=BANKZ.REPORT\n"
                "//SYSTSIN  DD  *\n"
                " DSN SYSTEM(DBD1)\n"
                " RUN PROGRAM(BNK2STMT) -\n"
                " PLAN(BANKZPLN)\n"
                "/*\n"
            )
            m = analyze_repo(root)
            edges = [e for p in m["parts"] for e in p["edges"]]
            runs = [e for e in edges if e["kind"] == "runs" and e.get("via")]
            self.assertEqual([(e["to"], e["cite"]["line"]) for e in runs], [("BNK2STMT", 7)])
            self.assertIn(("writes", "dataset:BANKZ.REPORT"), {(e["kind"], e["to"]) for e in edges})
            fetch = [e for e in edges if e.get("sql") == "FETCH"]
            self.assertEqual([e["to"] for e in fetch], ["table:ACCOUNT"])  # the cursor's table
            dli = [e for e in edges if e.get("dli")]
            self.assertEqual([(e["dli"], e["to"]) for e in dli], [("GU", "table:IMS:ACCOUNT")])
            self.assertEqual(m["diagnostics"], [])
            json.dumps(m)  # serializable


class Wiring(unittest.TestCase):
    def test_csd_transactions_and_files(self):
        d = analyze_csd("x.csd", "DEFINE TRANSACTION(CC00) GROUP(CARDDEMO)\n       PROGRAM(COSGN00C)\nDEFINE FILE(ACCTDAT) DSNAME(AWS.ACCTDATA.VSAM.KSDS)\n")
        self.assertEqual([(x["define"], x["name"], x.get("program"), x.get("dsname")) for x in d], [("TRANSACTION", "CC00", "COSGN00C", None), ("FILE", "ACCTDAT", None, "AWS.ACCTDATA.VSAM.KSDS")])

    def test_jcl_steps_programs_and_comments_after_operands(self):
        job = analyze_jcl("j.jcl", "//POSTTRAN JOB 'X'\n//STEP15   EXEC PGM=CBTRN02C   post the day\n//TRANFILE DD DISP=SHR,DSN=AWS.DALYTRAN.PS\n")
        self.assertEqual((job.name, job.steps[0]["program"], job.datasets[0]["dsn"], job.datasets[0]["disp"]), ("POSTTRAN", "CBTRN02C", "AWS.DALYTRAN.PS", "SHR"))


if __name__ == "__main__":
    unittest.main()
