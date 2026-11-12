import { describe, expect, it } from "vitest";

import { mapSummary, mergeMaps, pathsTo, type CodeMapPart } from "./code-map";
import { detectTechnologies, technologiesLine } from "./technologies";

const at = (file: string, line = 1) => ({ file, line });

// CardDemo's sign-on and menu (gen3-cradle.md B25), as three packs would report it.
const cics: CodeMapPart = {
  technology: { id: "cics", level: 2 },
  entries: [{ id: "TX:CC00", kind: "transaction", name: "CC00", unit: "COSGN00C", cite: at("app/csd/CARDDEMO.CSD", 40) }],
};
const cobol: CodeMapPart = {
  technology: { id: "cobol", level: 2 },
  units: [
    { id: "COSGN00C", kind: "program", name: "COSGN00C", tech: "cobol", cite: at("app/cbl/COSGN00C.cbl") },
    { id: "COADM01C", kind: "program", name: "COADM01C", tech: "cobol", cite: at("app/cbl/COADM01C.cbl") },
    { id: "COMEN01C", kind: "program", name: "COMEN01C", tech: "cobol", cite: at("app/cbl/COMEN01C.cbl") },
    { id: "COACTVWC", kind: "program", name: "COACTVWC", tech: "cobol", cite: at("app/cbl/COACTVWC.cbl") },
    { id: "CBTRN02C", kind: "program", name: "CBTRN02C", tech: "cobol", cite: at("app/cbl/CBTRN02C.cbl") },
  ],
  stores: [{ id: "USRSEC", kind: "file", name: "USRSEC" }],
  edges: [
    { from: "COSGN00C", to: "COADM01C", kind: "transfers", cite: at("app/cbl/COSGN00C.cbl", 231), when: "CDEMO-USRTYP-ADMIN" },
    { from: "COSGN00C", to: "COMEN01C", kind: "transfers", cite: at("app/cbl/COSGN00C.cbl", 236), when: "NOT CDEMO-USRTYP-ADMIN" },
    { from: "COSGN00C", to: "usrsec", kind: "reads", cite: at("app/cbl/COSGN00C.cbl", 211) },
    // The menu's target is data (a table in a copybook): resolved here to one of its values.
    { from: "COMEN01C", to: "CDEMO-MENU-OPT-PGMNAME", kind: "transfers", cite: at("app/cbl/COMEN01C.cbl", 150), dynamic: { via: "COMEN02Y", resolved: ["coactvwc"] } },
    { from: "COADM01C", to: "CDEMO-ADMIN-OPT-PGMNAME", kind: "transfers", cite: at("app/cbl/COADM01C.cbl", 140), dynamic: { via: "COADM02Y", resolved: [] } },
  ],
};
const jcl: CodeMapPart = {
  technology: { id: "jcl", level: 2 },
  units: [{ id: "POSTTRAN", kind: "job", name: "POSTTRAN", tech: "jcl", cite: at("app/jcl/POSTTRAN.jcl") }],
  entries: [{ id: "JOB:POSTTRAN.STEP15", kind: "job_step", name: "POSTTRAN STEP15", unit: "POSTTRAN", cite: at("app/jcl/POSTTRAN.jcl", 20) }],
  edges: [
    { from: "POSTTRAN", to: "cbtrn02c", kind: "runs", cite: at("app/jcl/POSTTRAN.jcl", 21) },
    { from: "POSTTRAN", to: "IEFBR14", kind: "runs", cite: at("app/jcl/POSTTRAN.jcl", 5) },
  ],
};

describe("mergeMaps", () => {
  const m = mergeMaps([cics, cobol, jcl]);

  it("resolves names across packs: a job step meets its program, a file its store, a dynamic target its program", () => {
    expect(m.edges.find((e) => e.kind === "runs" && e.cite.line === 21)!.to).toBe("CBTRN02C");
    expect(m.edges.find((e) => e.kind === "reads")!.to).toBe("USRSEC");
    expect(m.edges.find((e) => e.dynamic?.via === "COMEN02Y")!.dynamic!.resolved).toEqual(["COACTVWC"]);
    expect(m.technologies.map((t) => t.id)).toEqual(["cics", "cobol", "jcl"]);
  });

  it("says what it couldn't resolve and how many targets are data-driven", () => {
    const s = mapSummary(m);
    expect(s.unresolved).toEqual(["IEFBR14"]); // an IBM utility the estate calls but doesn't contain
    expect(s.dataDriven).toBe(1); // the admin menu's targets, not yet resolved
  });
});

describe("pathsTo (B25: reached from)", () => {
  const m = mergeMaps([cics, cobol, jcl]);

  it("finds every chain from an entry point, keeping each hop's condition and citation", () => {
    const { paths } = pathsTo(m, "COACTVWC");
    expect(paths).toHaveLength(1);
    expect(paths[0]!.map((e) => `${e.from}->${e.to}${e.when ? ` [${e.when}]` : ""}`)).toEqual([
      "COSGN00C->COMEN01C [NOT CDEMO-USRTYP-ADMIN]",
      "COMEN01C->COACTVWC",
    ]);
    expect(paths[0]![1]!.cite).toEqual({ file: "app/cbl/COMEN01C.cbl", line: 150 });
  });

  it("reaches batch programs from their job, and reports the unresolved hops instead of hiding them", () => {
    expect(pathsTo(m, "CBTRN02C").paths.map((p) => p.map((e) => e.from))).toEqual([["POSTTRAN"]]);
    expect(pathsTo(m, "COACTVWC").gaps.map((e) => e.from)).toEqual(["COADM01C"]);
  });
});

describe("detectTechnologies", () => {
  const files = [
    "app/cbl/COSGN00C.cbl", "app/cbl/CBTRN02C.cbl", "app/cpy/CVACT01Y.cpy", "app/cpy-bms/COSGN00.CPY", "app/jcl/POSTTRAN.jcl",
    "app/bms/COSGN00.bms", "app/csd/CARDDEMO.CSD", "app/scheduler/CardDemo.ca7", "app/ddl/TRNTYPE.ddl", "app/data/EBCDIC/AWS.M2.CARDDEMO.ACCTDATA.PS",
    "README.md", "app/asm/MVSWAIT.asm",
  ].map((path) => ({ path, lines: 100 }));
  const text = (p: string) => (p.endsWith("COSGN00C.cbl") ? "EXEC CICS XCTL PROGRAM(X) END-EXEC" : p.endsWith("CBTRN02C.cbl") ? "READ TRANSACT-FILE" : "");

  it("names each technology pack with its layer and level, and finds CICS inside COBOL by content", () => {
    const { detected, unclaimed } = detectTechnologies(files, text);
    const byId = Object.fromEntries(detected.map((d) => [d.id, d]));
    expect(byId.cobol).toMatchObject({ layer: "language", level: 1, files: 4 });
    expect(byId.jcl).toMatchObject({ files: 1 });
    expect(byId.cics).toMatchObject({ layer: "framework", on: ["cobol"], files: 3 }); // the screen, the CSD and the program with EXEC CICS
    expect(byId.scheduler!.files).toBe(1);
    expect(byId.db2!.files).toBe(1);
    expect(byId.hlasm).toMatchObject({ level: 0, files: 1 }); // Assembler: read by the model, said so
    expect(detectTechnologies([...files, { path: "app/x/TOOL.rexx", lines: 9 }], text).unclaimed).toEqual([{ ext: "rexx", files: 1 }]); // flagged, not skipped
    expect(technologiesLine(detected, unclaimed)).toContain("Assembler (HLASM) (L0) 1 files");
  });

  it("finds a modern stack in layers", () => {
    const web = ["app/page.tsx", "app/api/x/route.ts", "lib/a.ts", "next.config.ts", "components/b.tsx"].map((path) => ({ path, lines: 10 }));
    const ids = detectTechnologies(web).detected.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["typescript", "react", "nextjs"]));
  });
});
