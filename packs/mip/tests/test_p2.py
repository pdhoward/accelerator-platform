"""MIP P2 unit tests: resolution and interface checks, each a lesson from Bank of Z or CardDemo."""
import unittest

from mip.analyze import CopybookIndex
from mip.cobol import analyze, string_values
from mip.interfaces import compare
from mip.layout import Layout, elementary_size, flatten, table_values
from test_mip import fixed


def item(pic, usage=None, sign_separate=False):
    from mip.cobol import DataItem

    return DataItem(level=5, name="X", line=1, parent=None, pic=pic, usage=usage, sign_separate=sign_separate)


class Sizes(unittest.TestCase):
    def test_picture_sizes_follow_enterprise_cobol(self):
        cases = [
            ("X(8)", None, 8), ("S9(10)V99", None, 12), ("9(6)", None, 6), ("+9(10).99", None, 14), ("S9(8)", "COMP", 4),
            ("S9(4)", "COMP", 2), ("S9(18)", "COMP", 8), ("S9(10)V99", "COMP-3", 7), ("S9(4)V99", "COMP-3", 4), (None, "POINTER", 4), ("9", None, 1),
        ]
        for pic, usage, size in cases:
            self.assertEqual(elementary_size(item(pic, usage), usage), size, (pic, usage))
        self.assertEqual(elementary_size(item("S9(4)", sign_separate=True), None), 5)

    def test_edited_picture_is_one_token_even_with_a_period(self):
        p = analyze("x.cbl", fixed("DATA DIVISION.", "WORKING-STORAGE SECTION.", "01 A PIC +9(10).99.", "01 B PIC X(4)."))
        self.assertEqual((p.data["A"].pic, p.data["B"].pic), ("+9(10).99", "X(4)"))


MENU = fixed(
    "01 MENU-OPTIONS.",
    "  05 MENU-DATA.",
    "    10 FILLER PIC 9(02) VALUE 1.",
    "    10 FILLER PIC X(08) VALUE 'COACTVWC'.",
    "    10 FILLER PIC 9(02) VALUE 2.",
    "    10 FILLER PIC X(08) VALUE 'COACTUPC'.",
    "  05 MENU-TABLE REDEFINES MENU-DATA.",
    "    10 MENU-OPT OCCURS 3 TIMES.",
    "      15 MENU-NUM PIC 9(02).",
    "      15 MENU-PGM PIC X(08).",
)


class Resolution(unittest.TestCase):
    def test_a_table_is_read_the_way_the_program_reads_it(self):
        cp = analyze("MENU.cpy", MENU, "copybook")
        cp.name = "MENU"
        prog = analyze("COMEN.cbl", fixed("PROGRAM-ID. COMEN.", "DATA DIVISION.", "WORKING-STORAGE SECTION.", "COPY MENU."), copybooks={"MENU": cp})
        vals = table_values(Layout(prog, {"MENU": cp}), "MENU-PGM")
        self.assertEqual([(v["occurrence"], v["value"]) for v in vals], [(1, "COACTVWC"), (2, "COACTUPC")])  # the third slot is empty

    def test_string_built_in_a_loop(self):
        p = analyze("CRECUST.cbl", fixed(
            "PROGRAM-ID. CRECUST.", "DATA DIVISION.", "WORKING-STORAGE SECTION.",
            "01 WS-CC-CNT PIC 9 VALUE 0.", "01 WS-RUN-TRANSID PIC X(4).",
            "PROCEDURE DIVISION.", "MAIN.",
            "    PERFORM VARYING WS-CC-CNT FROM 1 BY 1", "       UNTIL WS-CC-CNT > 5",
            "       PERFORM SETUP", "       STRING 'OCR' DELIMITED BY SIZE,", "              WS-CC-CNT DELIMITED BY SIZE",
            "              INTO WS-RUN-TRANSID", "       END-STRING", "    END-PERFORM.",
        ))
        self.assertEqual([v["value"] for v in string_values(p, "WS-RUN-TRANSID")], ["OCR1", "OCR2", "OCR3", "OCR4", "OCR5"])


class Records(unittest.TestCase):
    def test_copy_replacing_names_the_record_and_copied_01_records_stand_alone(self):
        inq = analyze("INQACC.cpy", fixed("01 INQACC-COMMAREA.", "   03 INQACC-EYE PIC X(4).", "   03 INQACC-NO PIC 9(8)."), "copybook")
        inq.name = "INQACC"
        cbs = {"INQACC": inq}
        callee = analyze("INQACC.cbl", fixed("PROGRAM-ID. INQACC.", "DATA DIVISION.", "LINKAGE SECTION.", "COPY INQACC REPLACING INQACC-COMMAREA BY DFHCOMMAREA."), copybooks=cbs)
        self.assertEqual(Layout(callee, cbs).find("DFHCOMMAREA").name, "INQACC-COMMAREA")
        caller = analyze("BNK1DAC.cbl", fixed("PROGRAM-ID. BNK1DAC.", "DATA DIVISION.", "WORKING-STORAGE SECTION.", "01 PARMS.", "   03 P-EYE PIC X(4).", "COPY INQACC."), copybooks=cbs)
        lay = Layout(caller, cbs)
        self.assertEqual(lay.node(lay.find("PARMS")).total, 4)  # not 16: INQACC's 01 is a record of its own

    def test_fields_after_a_copied_01_continue_it(self):
        com = analyze("COCOM01Y.cpy", fixed("01 CARDDEMO-COMMAREA.", "   05 CDEMO-USER PIC X(8)."), "copybook")
        com.name = "COCOM01Y"
        cbs = {"COCOM01Y": com}
        p = analyze("COTRN00C.cbl", fixed("PROGRAM-ID. COTRN00C.", "DATA DIVISION.", "WORKING-STORAGE SECTION.", "01 OTHER PIC X(2).", "COPY COCOM01Y.", "   05 CDEMO-CT00-INFO PIC X(58)."), copybooks=cbs)
        lay = Layout(p, cbs)
        self.assertEqual((lay.node(lay.find("CARDDEMO-COMMAREA")).total, lay.node(lay.find("OTHER")).total), (66, 2))

    def test_the_copybook_nearest_the_program_wins(self):
        idx = CopybookIndex()
        api = analyze("src/api/providerFiles/XFRFUN.cpy", fixed("01 A PIC X."), "copybook")
        base = analyze("src/base/cics/copy/XFRFUN.cpy", fixed("03 B PIC X."), "copybook")
        for cp in (api, base):
            cp.name = "XFRFUN"
            idx.add("XFRFUN", cp)
        self.assertIs(idx.view("src/base/cics/cobol/XFRFUN.cbl")["XFRFUN"], base)
        self.assertEqual(list(idx.duplicates()), ["XFRFUN"])


def f(name, offset, size):
    return {"name": name, "offset": offset, "size": size, "line": 1, "file": "x"}


class Interfaces(unittest.TestCase):
    def test_bnk1cra_dbcrfun_is_high(self):
        caller = [f("SUBPGM-FILLER", 86, 4), f("SUBPGM-SUCCESS", 90, 1), f("SUBPGM-FAIL-CODE", 91, 1)]
        callee = [f("FILLER", 86, 4), f("COMM-DESCRIPTION", 90, 40), f("COMM-SUCCESS", 130, 1), f("COMM-FAIL-CODE", 131, 1)]
        r = compare(caller, 92, callee, 132, used={"COMM-DESCRIPTION", "COMM-SUCCESS", "COMM-FAIL-CODE"})
        self.assertEqual((r["verdict"], r["severity"], r["first_difference"]["offset"]), ("differs", "high", 90))

    def test_an_unused_missing_field_is_low(self):
        r = compare([f("A", 0, 118)], 118, [f("A", 0, 118), f("PCB3", 118, 4)], 122, used={"A"})
        self.assertEqual((r["verdict"], r["severity"]), ("differs", "low"))

    def test_opaque_bytes_read_as_a_structure_are_compatible(self):
        self.assertEqual(compare([f("REC", 20, 200)], 220, [f("A", 20, 10), f("B", 30, 190)], 220)["verdict"], "same")

    def test_a_bounded_copy_lets_the_callee_extend_the_area(self):
        r = compare([f("COMMON", 0, 160)], 160, [f("COMMON", 0, 160), f("OWN", 160, 58)], 218, used={"OWN"}, bounded=True)
        self.assertEqual(r["verdict"], "compatible")
        self.assertEqual(compare([f("COMMON", 0, 160)], 160, [f("COMMON", 0, 160), f("OWN", 160, 58)], 218, used={"OWN"})["severity"], "high")


if __name__ == "__main__":
    unittest.main()
