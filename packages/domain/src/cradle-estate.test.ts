import { describe, expect, it } from "vitest";

import { ingestInstruction } from "./cradle";
import { cobolSliceGuidance, estateOf, mergeReports, moduleOf, readReconcile, reconcileInstruction, roleOf } from "./cradle-estate";
import { PACKS } from "./cradle-packs";

// The shape of AWS CardDemo: a core module under app/, and optional modules beside it.
const programs = ["CBACT01C", "CBACT04C", "CBSTM03A", "CBTRN02C", "COACTUPC", "COACTVWC", "COBIL00C", "COCRDLIC", "COSGN00C", "COUSR01C"];
const files = [
  ...programs.map((p) => ({ path: `app/cbl/${p}.cbl`, lines: 700 })),
  { path: "app/cbl/CBSTM03B.CBL", lines: 300 },
  { path: "app/cpy/CVACT01Y.cpy", lines: 20 },
  { path: "app/cpy-bms/COACTUP.CPY", lines: 200 },
  { path: "app/jcl/INTCALC.jcl", lines: 60 },
  { path: "app/proc/TRANREPT.prc", lines: 50 },
  { path: "app/scheduler/CardDemo.ca7", lines: 300 },
  { path: "app/bms/COACTUP.bms", lines: 400 },
  { path: "app/csd/CARDDEMO.CSD", lines: 400 },
  { path: "app/data/EBCDIC/AWS.M2.CARDDEMO.ACCTDATA.PS", lines: 50 },
  { path: "app/app-authorization-ims-db2-mq/cbl/COPAUA0C.cbl", lines: 1000 },
  { path: "app/app-authorization-ims-db2-mq/ddl/AUTHFRDS.ddl", lines: 40 },
  { path: "app/app-authorization-ims-db2-mq/jcl/DBPAUTP0.jcl", lines: 40 },
  { path: "README.md", lines: 400 },
  { path: "samples/jcl/SAMPLE.jcl", lines: 40 },
];

describe("reading a mainframe estate", () => {
  it("knows each member by the role it plays", () => {
    expect(roleOf("app/cbl/CBACT04C.cbl")).toBe("program");
    expect(roleOf("app/cbl/CBSTM03B.CBL")).toBe("program");
    expect(roleOf("app/cpy/CVACT01Y.cpy")).toBe("copybook");
    expect(roleOf("app/cpy-bms/COACTUP.CPY")).toBe("copybook");
    expect(roleOf("app/jcl/INTCALC.jcl")).toBe("job");
    expect(roleOf("app/scheduler/CardDemo.controlm")).toBe("schedule");
    expect(roleOf("app/bms/COACTUP.bms")).toBe("screen");
    expect(roleOf("app/csd/CARDDEMO.CSD")).toBe("transaction");
    expect(roleOf("app/x/ddl/AUTHFRDS.ddl")).toBe("data_definition");
    expect(roleOf("app/data/EBCDIC/AWS.M2.CARDDEMO.ACCTDATA.PS")).toBe("data");
  });

  it("finds the module above the kind folder", () => {
    expect(moduleOf("app/cbl/CBACT04C.cbl")).toBe("app");
    expect(moduleOf("app/app-authorization-ims-db2-mq/cbl/COPAUA0C.cbl")).toBe("app/app-authorization-ims-db2-mq");
  });

  it("calls it COBOL, and cuts it into slices: programs in name order, then jobs, screens and data (one slice when small)", () => {
    const e = estateOf(files);
    expect(e.kind).toBe("cobol");
    // The census counts everything; only the application is sliced.
    expect(e.counts).toMatchObject({ program: 12, copybook: 2, job: 4, schedule: 1, data: 1 });
    expect(e.slices.map((s) => s.title)).toEqual([
      "app · programs 1/2 (CBACT01C–COBIL00C)",
      "app · programs 2/2 (COCRDLIC–COUSR01C)",
      "app · batch flow, screens and data definitions",
      "app-authorization-ims-db2-mq · programs 1/1 (COPAUA0C)",
      "app-authorization-ims-db2-mq · batch flow, screens and data definitions",
    ]);
    // No slice is over 8 programs or about 6,000 lines; copybooks, data and docs are never sliced.
    expect(e.slices.every((s) => s.files.filter((f) => roleOf(f) === "program").length <= 8 && s.lines <= 6000)).toBe(true);
    const sliced = e.slices.flatMap((s) => s.files);
    expect(sliced.some((f) => /cpy|data|README|samples/.test(f))).toBe(false);
    expect(e.copybookDirs).toEqual(["app/cpy", "app/cpy-bms"]);
    expect(e.slices[0]!.id).toBe("slice-1");
  });

  it("leaves a web app to the ordinary ingest", () => {
    expect(estateOf([{ path: "app/page.tsx", lines: 50 }, { path: "lib/checkout.ts", lines: 80 }]).kind).toBe("web");
  });

  it("tells each extractor how to read COBOL and which files are its own", () => {
    const e = estateOf(files);
    const text = ingestInstruction(PACKS.cards, cobolSliceGuidance(e, e.slices[0]!, 0));
    expect(text).toContain("Level-88 names are the allowed states");
    expect(text).toContain("You are extractor 1 of 5");
    expect(text).toContain("- app/cbl/CBACT04C.cbl");
    expect(text).toContain("app/cpy, app/cpy-bms");
    expect(text).toContain("Never open data files");
    expect(ingestInstruction(PACKS.commerce)).not.toContain("mainframe");
  });
});

describe("one book from many slices", () => {
  const src = (path: string) => [{ path, lines: "10" }];
  it("keeps one candidate per pack policy with every source, and drops repeated contradictions", () => {
    const merged = mergeReports([
      { summary: "Slice 1.", candidates: [{ packKey: "CC-INT-1", concept: "interest", event: "accrue", title: "Interest", statement: "a", parameters: { divisor: 1200 }, form: "parametric", sources: src("app/cbl/CBACT04C.cbl") }], conflicts: [{ keys: ["A", "B"], why: "x" }] },
      { summary: "Slice 2.", candidates: [
        { packKey: "CC-INT-1", concept: "interest", event: "accrue", title: "Interest", statement: "b", parameters: { divisor: 1200 }, form: "parametric", sources: src("app/cbl/CBSTM03A.cbl") },
        { packKey: null, concept: "other", event: "x", title: "Sign-on retries", statement: "c", parameters: {}, form: "structural", sources: src("app/cbl/COSGN00C.cbl") },
      ], conflicts: [{ keys: ["B", "A"], why: "same" }] },
    ]);
    expect(merged.candidates).toHaveLength(2);
    expect(merged.candidates[0]!.sources.map((s) => s.path)).toEqual(["app/cbl/CBACT04C.cbl", "app/cbl/CBSTM03A.cbl"]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.summary).toBe("Slice 1. Slice 2.");
  });

  it("asks the reconciler for what no slice can see, and reads its answer leniently", () => {
    const text = reconcileInstruction(PACKS.cards, { summary: "", candidates: [], conflicts: [] });
    expect(text).toContain("Implementation against implementation");
    expect(text).toContain("Regulation Z §1026.53");
    expect(readReconcile('clerk> CONFLICT a vs b\n```json\n{"conflicts":[{"keys":["CC-INT-1","Statement interest"],"why":"two divisors","kind":"policy"},{"keys":[],"why":"no keys"}]}\n```')).toEqual([
      { keys: ["CC-INT-1", "Statement interest"], why: "two divisors", kind: "policy" },
    ]);
    expect(readReconcile("no json here")).toEqual([]);
  });
});
