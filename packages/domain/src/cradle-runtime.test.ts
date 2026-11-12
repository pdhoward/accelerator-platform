import { describe, expect, it } from "vitest";

import type { CradleResponse } from "./cradle";
import { fingerprint, runtimeBook } from "./cradle-runtime";

const policy = (key: string, status: string, statement = `${key} statement`) =>
  ({ key, title: key, statement, concept: "checkout", event: "pay", criticality: "critical", parameters: {}, kernel: null, status, version: 1 }) as never;

const cradle = (book: unknown[], conflicts: unknown[] = []) =>
  ({ cradle: null, pack: { id: "ecommerce", version: "1.0" }, book, conflicts, findings: [], readiness: null, alignments: [], ingest: null }) as unknown as CradleResponse;

describe("runtimeBook", () => {
  const site = { id: "s1", name: "Machine Shop" };
  it("keeps the policies in force and the steward's rulings", () => {
    const b = runtimeBook(cradle([policy("B", "confirmed"), policy("A", "unreviewed"), policy("C", "retired")], [
      { id: "x", keys: ["B", "A"], why: "", kind: "policy", status: "resolved", ruling: "A wins" },
      { id: "y", keys: ["A"], why: "", kind: "policy", status: "open" },
    ]), site, "t");
    expect(b.policies.map((p) => p.key)).toEqual(["A", "B"]);
    expect(b.rulings).toEqual([{ id: "x", keys: ["A", "B"], ruling: "A wins" }]);
  });
  it("states a ruling once, with every policy it settled", () => {
    const b = runtimeBook(cradle([], [
      { id: "1", keys: ["A", "B"], why: "", kind: "policy", status: "resolved", ruling: "Same words" },
      { id: "2", keys: ["C", "A"], why: "", kind: "policy", status: "resolved", ruling: "Same words" },
    ]), site, "t");
    expect(b.rulings).toEqual([{ id: "1", keys: ["A", "B", "C"], ruling: "Same words" }]);
  });
  it("changes version exactly when the rules change", () => {
    const one = runtimeBook(cradle([policy("A", "confirmed")]), site, "t1");
    const same = runtimeBook(cradle([policy("A", "confirmed")]), site, "t2");
    const changed = runtimeBook(cradle([policy("A", "confirmed", "A, restated")]), site, "t3");
    expect(same.version).toBe(one.version);
    expect(changed.version).not.toBe(one.version);
  });
  it("carries the site's own description and the pack's grounding, without changing the rules' version", () => {
    const pack = { id: "commerce", version: "1.0", label: "Commerce", summary: "Online stores.", concepts: [{ key: "price", label: "Price", events: [], floor: "important" }], grounding: { search: ["price"] } };
    const rich = { ...cradle([policy("A", "confirmed")]), pack } as unknown as CradleResponse;
    const plain = { ...cradle([policy("A", "confirmed")]), pack: { id: "commerce", version: "1.0" } } as unknown as CradleResponse;
    const b = runtimeBook(rich, { ...site, description: "A home and workshop store." }, "t");
    expect(b.site.description).toBe("A home and workshop store.");
    expect(b.pack).toEqual({ id: "commerce", version: "1.0", label: "Commerce", summary: "Online stores.", concepts: [{ key: "price", label: "Price" }], kernels: [], grounding: { search: ["price"] } });
    expect(b.version).toBe(runtimeBook(plain, site, "t").version); // describing the site or the pack never triggers a recompile and proof
  });
  it("fingerprints are short and stable", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
});
