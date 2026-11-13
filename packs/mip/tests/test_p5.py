"""MIP P5 unit tests: data lineage across programs, files, sorts, calls and DB2, with definition changes."""
import json
import tempfile
import unittest
from pathlib import Path

from mip.lineage import Lineage, changes, concepts, describe, moved, reformat, sql_writes
from test_mip import fixed


class Item:
    def __init__(self, pic, usage=None):
        self.pic, self.usage = pic, usage


class Pictures(unittest.TestCase):
    def test_what_changes_when_a_value_moves(self):
        rate, amount, printed = describe(Item("S9(04)V99")), describe(Item("S9(09)V99")), describe(Item("Z(9).99-"))
        self.assertEqual((rate["int"], rate["dec"], rate["signed"]), (4, 2, True))
        self.assertEqual(changes(rate, amount), ["integer digits 4 → 9"])
        self.assertIn("becomes edited text for display (Z(9).99-)", changes(amount, printed))
        self.assertIn("decimals 2 → 0: truncated", changes(amount, describe(Item("S9(09)"))))
        self.assertIn("usage COMP-3 → DISPLAY", changes(describe(Item("S9(10)V99", "COMP-3")), describe(Item("S9(10)V99"))))


class Sort(unittest.TestCase):
    def test_outrec_moves_the_bytes(self):
        segs = reformat(" SORT FIELDS=(263,16,CH,A,1,16,CH,A)\n OUTREC FIELDS=(1:263,16,17:1,262,279:279,50)")
        self.assertEqual(moved(segs, 132, 11), 148)  # CardDemo's CREASTMT: the amount shifts 16 bytes
        self.assertEqual(moved(segs, 262, 16), 0)  # the card number moves to the front
        self.assertEqual(moved(None, 132, 11), 132)  # no reformat: same place
        self.assertIsNone(moved(reformat(" OUTREC FIELDS=(1,10)"), 20, 5))  # dropped by the reformat


class Names(unittest.TestCase):
    def test_business_words_behind_abbreviations(self):
        self.assertEqual(concepts("DIS-INT-RATE"), concepts("INTEREST-RATE"))
        self.assertEqual(concepts("WS-TRAN-AMT"), frozenset({"TRANSACTION", "AMOUNT"}))
        self.assertEqual(concepts("I-RATE"), frozenset({"I", "RATE"}))

    def test_sql_writes_map_columns_to_host_variables(self):
        self.assertEqual(sql_writes("EXEC SQL UPDATE ACCOUNT SET ACCOUNT_BALANCE = :HV-BAL, ACCOUNT_RATE = :HV-RATE WHERE ID = :HV-ID END-EXEC"),
                         [("ACCOUNT", "ACCOUNT_BALANCE", "HV-BAL"), ("ACCOUNT", "ACCOUNT_RATE", "HV-RATE")])
        self.assertEqual(sql_writes("EXEC SQL INSERT INTO PROCTRAN (AMOUNT, DESCR) VALUES (:HV-AMT, :HV-DESC) END-EXEC"),
                         [("PROCTRAN", "AMOUNT", "HV-AMT"), ("PROCTRAN", "DESCR", "HV-DESC")])


RATES = fixed(
    "IDENTIFICATION DIVISION.", "PROGRAM-ID. RATES.",
    "ENVIRONMENT DIVISION.", "INPUT-OUTPUT SECTION.", "FILE-CONTROL.",
    "    SELECT RATE-FILE ASSIGN TO RATEIN.",
    "    SELECT OUT-FILE ASSIGN TO TRANOUT.",
    "DATA DIVISION.", "FILE SECTION.",
    "FD RATE-FILE.", "01 FD-RATE-REC PIC X(20).",
    "FD OUT-FILE.", "01 FD-OUT-REC PIC X(30).",
    "WORKING-STORAGE SECTION.",
    "01 RATE-REC.", "   05 R-KEY PIC X(10).", "   05 INT-RATE PIC S9(04)V99.", "   05 FILLER PIC X(4).",
    "01 OUT-REC.", "   05 O-ID PIC X(9).", "   05 O-AMT PIC S9(09)V99.", "   05 FILLER PIC X(10).",
    "01 WS-BAL PIC S9(09)V99.",
    "PROCEDURE DIVISION.",
    "MAIN.",
    "    READ RATE-FILE INTO RATE-REC",
    "    IF INT-RATE NOT = 0",
    "       COMPUTE O-AMT = (WS-BAL * INT-RATE) / 1200",
    "       WRITE FD-OUT-REC FROM OUT-REC",
    "    END-IF",
    "    GOBACK.",
)

STMT = fixed(
    "IDENTIFICATION DIVISION.", "PROGRAM-ID. STMT.",
    "ENVIRONMENT DIVISION.", "INPUT-OUTPUT SECTION.", "FILE-CONTROL.",
    "    SELECT TRAN-FILE ASSIGN TO TRANIN.",
    "DATA DIVISION.", "FILE SECTION.",
    "FD TRAN-FILE.", "01 FD-TRAN-REC PIC X(40).",
    "WORKING-STORAGE SECTION.",
    "01 TRNX-REC.", "   05 T-CARD PIC X(10).", "   05 T-ID PIC X(9).", "   05 I-AMOUNT PIC S9(09)V99.", "   05 FILLER PIC X(10).",
    "01 ST-LINE.", "   05 ST-AMT PIC Z(9).99-.",
    "PROCEDURE DIVISION.",
    "MAIN.",
    "    READ TRAN-FILE INTO TRNX-REC",
    "    MOVE I-AMOUNT TO ST-AMT",
    "    GOBACK.",
)

JOBS = """//INTJOB  JOB 'INTEREST'
//STEP1    EXEC PGM=RATES
//RATEIN   DD DISP=SHR,DSN=BANK.RATES
//TRANOUT  DD DISP=(NEW,CATLG),DSN=BANK.INTTRAN(+1)
//STEP2    EXEC PGM=SORT
//SORTIN   DD DISP=SHR,DSN=BANK.INTTRAN(0)
//SORTOUT  DD DISP=(NEW,CATLG),DSN=BANK.INTTRAN.SORTED
//SYSIN    DD *
  SORT FIELDS=(1,10,CH,A)
  OUTREC FIELDS=(1:21,10,11:1,20)
/*
//STEP3    EXEC PGM=STMT
//TRANIN   DD DISP=SHR,DSN=BANK.INTTRAN.SORTED
"""


class Lineage_(unittest.TestCase):
    def test_a_rate_becomes_an_amount_moves_through_a_sort_and_is_printed(self):
        from mip.trace import Model

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "RATES.cbl").write_text(RATES)
            (root / "STMT.cbl").write_text(STMT)
            (root / "INTJOB.jcl").write_text(JOBS)
            t = Lineage(Model(root), root).trace("RATES", "INT-RATE")
        hops = [(h["how"].split(" ")[0], t["nodes"][h["to"]].get("field") or t["nodes"][h["to"]].get("dataset"), h["change"]) for h in t["hops"]]
        self.assertEqual(hops[0][:2], ("COMPUTE", "O-AMT"))
        self.assertTrue(any("no ROUNDED" in c for c in hops[0][2]))
        sort = next(h for h in t["hops"] if h["how"].startswith("SORT"))
        self.assertEqual((t["nodes"][sort["from"]]["offset"], t["nodes"][sort["to"]]["offset"]), (9, 19))  # O-AMT, then after the reformat moved the last 10 bytes to the front
        landed = next(h for h in t["hops"] if h["how"].startswith("DD TRANIN"))
        self.assertEqual(t["nodes"][landed["to"]]["field"], "I-AMOUNT")  # renamed: the same bytes under another name
        printed = next(h for h in t["hops"] if t["nodes"][h["to"]].get("field") == "ST-AMT")
        self.assertIn("becomes edited text for display (Z(9).99-)", printed["change"])
        self.assertEqual([o["kind"] for o in t["operations"] if o["program"] == "RATES"], ["decides"])
        self.assertIn("comes from", __import__("mip.lineage", fromlist=["render"]).render(t))


CARDDEMO = Path("C:/Users/patri/Desktop/machine/carddemo")
EXPECTED = Path("C:/Users/patri/Desktop/machine/accelerator/work/mip/carddemo.expected.json")


@unittest.skipUnless(CARDDEMO.exists() and EXPECTED.exists(), "CardDemo corpus not present")
class GoldenLineage(unittest.TestCase):
    def test_the_interest_rate_is_followed_through_the_batch_cycle(self):
        from mip.bench import score_p5
        from mip.trace import Model

        t = Lineage(Model(CARDDEMO), CARDDEMO).trace("CBACT04C", "DIS-INT-RATE")
        r = score_p5(json.loads(EXPECTED.read_text(encoding="utf-8")), t)
        self.assertEqual((r["covered"], r["changes_flagged"]), (r["total"], r["changes_total"]), [x for x in r["rows"] if not x["covered"]])


if __name__ == "__main__":
    unittest.main()
