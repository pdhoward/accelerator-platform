"""MIP P4 unit tests: rule candidates, values returned through a LINK, paragraphs that never return,
CICS resource definitions, and the golden rules."""
import json
import tempfile
import unittest
from pathlib import Path

from mip.cobol import analyze
from mip.flow import build
from mip.jcl import analyze_csd
from mip.trace import business
from test_mip import fixed

LIMITS = fixed(
    "IDENTIFICATION DIVISION.",
    "PROGRAM-ID. LIMITS.",
    "DATA DIVISION.",
    "WORKING-STORAGE SECTION.",
    "01 WS-COUNT PIC 9(4).",
    "01 WS-RESP PIC S9(8) COMP.",
    "LINKAGE SECTION.",
    "01 DFHCOMMAREA.",
    "   03 COMM-CUST PIC 9(10).",
    "   03 COMM-OK PIC X.",
    "   03 COMM-FAIL PIC X.",
    "PROCEDURE DIVISION.",
    "MAIN SECTION.",
    "A010.",
    "    EXEC SQL SELECT COUNT(*) INTO :WS-COUNT FROM ACCOUNT END-EXEC",
    "    IF SQLCODE NOT = 0",
    "       MOVE '9' TO COMM-FAIL",
    "       PERFORM GET-OUT",
    "    END-IF",
    "    IF WS-COUNT > 9",
    "       MOVE 'N' TO COMM-OK",
    "       MOVE '8' TO COMM-FAIL",
    "    ELSE",
    "       MOVE 'Y' TO COMM-OK",
    "    END-IF",
    "    PERFORM GET-OUT.",
    "GET-OUT SECTION.",
    "G010.",
    "    EXEC CICS RETURN END-EXEC.",
)

COUNTER = fixed(
    "PROGRAM-ID. COUNTER.", "DATA DIVISION.", "LINKAGE SECTION.",
    "01 DFHCOMMAREA.", "   03 CNT-CUST PIC 9(10).", "   03 CNT-NUMBER PIC 9(4).",
    "PROCEDURE DIVISION.", "A010.",
    "    MOVE ZERO TO CNT-NUMBER",
    "    PERFORM UNTIL SQLCODE NOT = 0 OR",
    "       CNT-NUMBER = 20",
    "       ADD 1 TO CNT-NUMBER",
    "    END-PERFORM",
    "    EXEC CICS RETURN END-EXEC.",
)

OPENER = fixed(
    "PROGRAM-ID. OPENER.", "DATA DIVISION.", "WORKING-STORAGE SECTION.",
    "01 CNT-AREA.", "   03 C-CUST PIC 9(10).", "   03 C-NUMBER PIC 9(4).",
    "LINKAGE SECTION.",
    "01 DFHCOMMAREA.", "   03 COMM-CUST PIC 9(10).", "   03 COMM-FAIL PIC X.",
    "PROCEDURE DIVISION.", "A010.",
    "    MOVE COMM-CUST TO C-CUST",
    "    EXEC CICS LINK PROGRAM('COUNTER') COMMAREA(CNT-AREA) END-EXEC",
    "    IF C-NUMBER > 9",
    "       MOVE '8' TO COMM-FAIL",
    "    END-IF",
    "    EXEC CICS RETURN END-EXEC.",
)


class Classify(unittest.TestCase):
    def test_technical_conditions_and_loops_are_not_business(self):
        self.assertFalse(business("SQLCODE NOT = 0"))
        self.assertFalse(business("WS-CICS-RESP NOT = DFHRESP (NORMAL)"))
        self.assertFalse(business("MY-ABEND-CODE = 'AFCR'"))
        self.assertFalse(business("PERFORM UNTIL WS-DONE = 'Y'", "loop"))
        self.assertTrue(business("WS-COUNT > 9"))
        self.assertTrue(business("EIBRESP NOT = DFHRESP (NORMAL) OR INQ-SUCCESS NOT = 'Y'"))


class Flow(unittest.TestCase):
    def test_a_perform_of_a_section_that_returns_is_an_earlier_exit(self):
        f = build(analyze("LIMITS.cbl", LIMITS))
        self.assertEqual([g.render() for g in f.at(21).guards], ["NOT (SQLCODE NOT = 0)", "WS-COUNT > 9"])

    def test_a_loop_condition_spans_its_lines(self):
        f = build(analyze("COUNTER.cbl", COUNTER))
        loop = f.at(12).guards[0]
        self.assertEqual((loop.kind, loop.line, loop.end), ("loop", 10, 11))


class Candidates(unittest.TestCase):
    def model(self, files):
        from mip.trace import Model

        d = tempfile.mkdtemp()
        for name, text in files.items():
            (Path(d) / name).write_text(text)
        return Model(Path(d))

    def test_one_candidate_per_business_decision_then_and_else_together(self):
        from mip.rules import candidates

        c = candidates(self.model({"LIMITS.cbl": LIMITS}))
        self.assertEqual([p["id"] for p in c], ["LIMITS:21"])
        p = c[0]
        self.assertEqual({(o["field"], o["value"]) for o in p["outcome"]}, {("COMM-OK", "N"), ("COMM-FAIL", "8"), ("COMM-OK", "Y")})
        self.assertEqual(len(p["branches"]), 2)
        self.assertIn("db2:ACCOUNT", json.dumps(p["decided_by"]["WS-COUNT"]))

    def test_a_value_returned_through_a_link_is_traced_into_the_called_program(self):
        from mip.trace import Model, Tracer

        m = self.model({"OPENER.cbl": OPENER, "COUNTER.cbl": COUNTER})
        nodes = Tracer(m).lineage("OPENER", "C-NUMBER", 3, 15, None, "A010")
        hop = next(n for n in nodes if n["how"] == "returned by LINK")
        self.assertEqual((hop["callee"], hop["as"]), ("COUNTER", "CNT-NUMBER"))
        self.assertIn("ADD 1 TO CNT-NUMBER", json.dumps(hop["set_by"]))
        add = next(n for n in hop["set_by"] if n["how"] == "ADD")
        self.assertEqual([(g["line"], g["end"]) for g in add["when"] if g["kind"] == "loop"], [(10, 11)])


class Resources(unittest.TestCase):
    def test_cics_resource_builder_yaml(self):
        text = "resourceDefinitions:\n  - transaction:\n      name: OCR1\n      group: G\n      program: CRDTAGY1\n  - file:\n      name: ABNDFILE\n      dsname: BANK.ABND\n"
        got = [(d["define"], d["name"], d.get("program") or d.get("dsname")) for d in analyze_csd("defs.yaml", text)]
        self.assertEqual(got, [("TRANSACTION", "OCR1", "CRDTAGY1"), ("FILE", "ABNDFILE", "BANK.ABND")])


BOZ = Path("C:/Users/patri/Desktop/machine/corpus/bank-of-z")
EXPECTED = Path("C:/Users/patri/Desktop/machine/accelerator/work/mip/bank-of-z.expected.json")


@unittest.skipUnless(BOZ.exists() and EXPECTED.exists(), "Bank of Z corpus not present")
class GoldenRules(unittest.TestCase):
    def test_the_golden_rules_are_found_with_their_evidence(self):
        from mip.bench import score_p4
        from mip.rules import candidates, with_text
        from mip.trace import Model

        packets = with_text(BOZ, candidates(Model(BOZ), ["DBCRFUN", "CREACC", "CRECUST"]))
        r = score_p4(json.loads(EXPECTED.read_text(encoding="utf-8")), packets)
        self.assertEqual(r["found"], r["total"], r["rules"])


if __name__ == "__main__":
    unittest.main()
