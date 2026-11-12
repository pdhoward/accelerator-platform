"""MIP P3 unit tests: statements, guards, data, and traces across programs."""
import json
import tempfile
import unittest
from pathlib import Path

from mip.cobol import analyze
from mip.flow import build
from test_mip import fixed

PROG = fixed(
    "IDENTIFICATION DIVISION.",
    "PROGRAM-ID. DBCR.",
    "DATA DIVISION.",
    "WORKING-STORAGE SECTION.",
    "01 WS-DIFF PIC S9(10)V99.",
    "01 HV-BAL PIC S9(10)V99.",
    "01 WS-TYPE PIC X.",
    "   88 TYPE-ADMIN VALUE 'A'.",
    "01 USER-REC.",
    "   05 USER-PWD PIC X(8).",
    "LINKAGE SECTION.",
    "01 DFHCOMMAREA.",
    "   03 COMM-AMT PIC S9(10)V99.",
    "   03 COMM-FAIL PIC X.",
    "PROCEDURE DIVISION.",
    "MAIN SECTION.",
    "A010.",
    "    EXEC SQL SELECT ACCOUNT_BALANCE, ACCOUNT_TYPE",
    "         INTO :HV-BAL, :WS-TYPE FROM ACCOUNT END-EXEC",
    "    IF SQLCODE NOT = 0",
    "       MOVE '1' TO COMM-FAIL",
    "       GO TO A999",
    "    END-IF",
    "    IF COMM-AMT < 0",
    "       COMPUTE WS-DIFF = HV-BAL + COMM-AMT",
    "       IF WS-DIFF < 0",
    "          MOVE '3' TO COMM-FAIL",
    "          GO TO A999",
    "       END-IF",
    "    END-IF",
    "    EVALUATE TRUE",
    "       WHEN TYPE-ADMIN",
    "          MOVE 'X' TO COMM-FAIL",
    "       WHEN OTHER",
    "          CONTINUE",
    "    END-EVALUATE",
    "    READ USERFILE INTO USER-REC",
    "       AT END MOVE 'E' TO COMM-FAIL",
    "    END-READ",
    "    MOVE 'Y' TO COMM-FAIL.",
    "A999.",
    "    EXIT.",
)


class Flow(unittest.TestCase):
    def setUp(self):
        self.f = build(analyze("DBCR.cbl", PROG))

    def guards(self, line):
        return [g.render() for g in self.f.at(line).guards]

    def test_statements_and_sections(self):
        self.assertEqual([(p.name, p.kind) for p in self.f.paragraphs], [("MAIN", "section"), ("A010", "paragraph"), ("A999", "paragraph")])
        self.assertEqual(self.f.at(27).kind, "MOVE")  # MOVE '3' (fixture line 27)

    def test_guards_with_earlier_exits_nested_and_evaluate(self):
        self.assertEqual(self.guards(27), ["NOT (SQLCODE NOT = 0)", "COMM-AMT < 0", "WS-DIFF < 0"])
        self.assertEqual(self.guards(33), ["NOT (SQLCODE NOT = 0)", "NOT (COMM-AMT < 0 AND WS-DIFF < 0)", "TYPE-ADMIN"])
        self.assertEqual(self.guards(38)[-1], "AT END")

    def test_sql_into_column_by_column_and_compute_sources(self):
        sets = {x["field"]: x["from"] for x in self.f.at(18).sets}
        self.assertEqual(sets, {"HV-BAL": ["db2:ACCOUNT.ACCOUNT_BALANCE"], "WS-TYPE": ["db2:ACCOUNT.ACCOUNT_TYPE"]})
        self.assertEqual(self.f.at(25).sets[0]["from"], ["HV-BAL", "COMM-AMT"])


class Trace(unittest.TestCase):
    def test_a_trace_across_programs_through_the_commarea(self):
        caller = fixed(
            "PROGRAM-ID. TELLER.", "DATA DIVISION.", "WORKING-STORAGE SECTION.",
            "01 PARMS.", "   03 P-AMT PIC S9(10)V99.", "   03 P-FAIL PIC X.",
            "01 WS-IN PIC S9(10)V99.", "01 SIGN-IN PIC X.",
            "PROCEDURE DIVISION.", "MAIN.",
            "    IF SIGN-IN = '-'", "       COMPUTE WS-IN = WS-IN * -1", "    END-IF",
            "    MOVE WS-IN TO P-AMT",
            "    EXEC CICS LINK PROGRAM('DBCR') COMMAREA(PARMS) END-EXEC",
            "    EVALUATE P-FAIL", "      WHEN '3' MOVE 'NO FUNDS' TO SIGN-IN", "    END-EVALUATE.",
        )
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "DBCR.cbl").write_text(PROG)
            (root / "TELLER.cbl").write_text(caller)
            from mip.trace import Model, Tracer

            t = Tracer(Model(root)).trace("DBCR", 27)
        amt = t["decided_by"]["COMM-AMT"]
        hop = next(n for n in amt if n["how"] == "COMMAREA")
        self.assertEqual((hop["program"], hop["as"]), ("TELLER", "P-AMT"))
        self.assertIn("SIGN-IN = '-'", json.dumps(hop["set_by"]))
        self.assertEqual(t["reached_from"]["programs"][0]["program"], "TELLER")
        back = next(o for o in t["outcome"] if o["sets"] == "COMM-FAIL")["returned_to"][0]
        self.assertEqual((back["seen_as"], back["uses"][0]["branch"][0]["text"]), ("P-FAIL", "MOVE 'NO FUNDS' TO SIGN-IN"))
        self.assertEqual(t["review"], [])

    def test_condition_names_and_groups_are_traced_through_their_parents(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "DBCR.cbl").write_text(PROG)
            from mip.trace import Model, Tracer

            t = Tracer(Model(root)).trace("DBCR", 33)
        admin = json.dumps(t["decided_by"]["TYPE-ADMIN"])
        self.assertIn("condition name of WS-TYPE", admin)
        self.assertIn("db2:ACCOUNT.ACCOUNT_TYPE", admin)


BOZ = Path("C:/Users/patri/Desktop/machine/corpus/bank-of-z")
EXPECTED = Path("C:/Users/patri/Desktop/machine/accelerator/work/mip/bank-of-z.expected.json")


@unittest.skipUnless(BOZ.exists() and EXPECTED.exists(), "Bank of Z corpus not present")
class GoldenTrace(unittest.TestCase):
    def test_the_golden_trace_is_reproduced(self):
        from mip.bench import score_p3
        from mip.trace import Model, Tracer

        m = Model(BOZ)
        traces = [Tracer(m).trace("DBCRFUN", 347), Tracer(m).trace("DBCRFUN", 392)]
        r = score_p3(json.loads(EXPECTED.read_text(encoding="utf-8")), traces)
        self.assertEqual(r["covered"], r["total"], [x for x in r["rows"] if not x["covered"]])
        kinds = {x["kind"] for x in traces[0]["review"]}
        self.assertEqual(kinds, {"runtime_value", "interface"})


if __name__ == "__main__":
    unittest.main()
