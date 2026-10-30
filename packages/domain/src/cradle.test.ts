import { describe, expect, it } from "vitest";

import { applyRuling, assembleBook, criticalityOf, findings, ingestInstruction, mergeIngest, readiness, readIngest, starterSteps, type SitePolicy } from "./cradle";
import { PACKS } from "./cradle-packs";

const commerce = PACKS.commerce;

describe("the starter book", () => {
  it("adopts every pack policy, unreviewed, before anything is ingested", () => {
    const book = assembleBook(commerce, []);
    expect(book).toHaveLength(commerce.policies.length);
    expect(book.every((p) => p.binding === "adopted" && p.status === "unreviewed")).toBe(true);
  });

  it("finds the holes the pack leaves on purpose (lifecycle events with no policy)", () => {
    const found = findings(commerce, assembleBook(commerce, []), []);
    const holes = found.filter((f) => f.kind === "hole").map((f) => `${f.at!.concept}/${f.at!.event}`);
    expect(holes).toEqual(expect.arrayContaining(["product/publish", "product/retire", "assistant/escalate"]));
    expect(holes).not.toContain("checkout/pay");
  });

  it("flags critical policies whose kernel isn't built, and orders findings critical first", () => {
    const found = findings(commerce, assembleBook(commerce, []), []);
    expect(found.some((f) => f.kind === "needs_kernel" && f.keys[0] === "C-ORD-1")).toBe(true);
    expect(found[0]!.criticality).toBe("critical");
  });

  it("isn't complete until every critical policy is confirmed", () => {
    const book = assembleBook(commerce, []);
    expect(readiness(book, findings(commerce, book, [])).complete).toBe(false);
  });

  it("prints a scaffold like a framework's create command", () => {
    expect(starterSteps(commerce).map((s) => s.label)).toContain("Starter policies");
  });
});

describe("criticality", () => {
  it("never drops below the concept's floor", () => {
    expect(criticalityOf(commerce, "checkout", "routine")).toBe("critical");
    expect(criticalityOf(commerce, "assistant", "important")).toBe("important");
  });
});

describe("ingest", () => {
  const report = readIngest(`I read the repo.
\`\`\`json
{"summary": "Stripe checkout with flat shipping.",
 "candidates": [
  {"packKey": "C-SHIP-1", "concept": "shipping", "event": "quote", "title": "Flat shipping", "statement": "Shipping is $9.95 per order.", "parameters": {"flatFeeUsd": 9.95}, "form": "parametric", "sources": [{"path": "lib/checkout.ts", "lines": "4", "quote": "SHIPPING_CENTS = 995"}]},
  {"packKey": "C-CHK-1", "concept": "checkout", "event": "pay", "title": "Stripe", "statement": "Stripe takes payment.", "parameters": {"provider": "stripe"}, "form": "structural", "sources": [{"path": "app/api/checkout/route.ts"}]},
  {"packKey": null, "concept": "checkout", "event": "test_mode", "title": "Test mode only", "statement": "The store uses Stripe test mode.", "parameters": {"mode": "test"}, "form": "parametric", "criticality": "routine", "sources": [{"path": "app/layout.tsx"}], "surfaces": ["app/layout.tsx"]}
 ],
 "conflicts": [{"keys": ["Test mode only", "C-ORD-2"], "why": "No email is sent in test mode.", "kind": "surface"}]}
\`\`\``);

  it("reads the extractor's report", () => {
    expect(report.candidates).toHaveLength(3);
    expect(report.conflicts[0]!.kind).toBe("surface");
  });

  it("adopts matches, records overrides found in code, and keys the site's own policies", () => {
    const { policies, conflicts } = mergeIngest(commerce, [], report);
    const ship = policies.find((p) => p.key === "C-SHIP-1")!;
    expect(ship.binding).toBe("overridden");
    expect(ship.parameters).toEqual({ flatFeeUsd: 9.95 });
    expect(policies.find((p) => p.key === "C-CHK-1")!.binding).toBe("adopted");
    const own = policies.find((p) => p.binding === "site")!;
    expect(own.key).toBe("S-CHECKO-1");
    expect(own.criticality).toBe("routine");
    expect(conflicts[0]!.keys).toEqual(["S-CHECKO-1", "C-ORD-2"]);
    expect(policies.every((p) => p.status === "unreviewed")).toBe(true);
  });

  it("raises a site policy to its concept's floor in the book", () => {
    const { policies } = mergeIngest(commerce, [], report);
    const book = assembleBook(commerce, policies);
    expect(book.find((p) => p.key === "S-CHECKO-1")!.criticality).toBe("critical");
    expect(book.find((p) => p.key === "C-SHIP-1")!.packParameters).toEqual({ flatFeeUsd: 7.95 });
  });

  it("keeps a ruling when the code still matches it, and reopens it when the code changed", () => {
    const confirmed: SitePolicy = { key: "C-SHIP-1", binding: "overridden", parameters: { flatFeeUsd: 9.95 }, status: "confirmed", version: 2, ruledBy: "Sally" };
    expect(mergeIngest(commerce, [confirmed], report).policies.find((p) => p.key === "C-SHIP-1")!.status).toBe("confirmed");
    const stale = { ...confirmed, parameters: { flatFeeUsd: 5 } };
    expect(mergeIngest(commerce, [stale], report).policies.find((p) => p.key === "C-SHIP-1")!.status).toBe("unreviewed");
  });

  it("rejects a report without JSON", () => {
    expect(() => readIngest("no report")).toThrow();
  });

  it("tells the extractor the pack's keys and the report shape", () => {
    const text = ingestInstruction(commerce);
    expect(text).toContain("C-SHIP-1");
    expect(text).toContain("```json");
  });
});

describe("rulings", () => {
  it("confirms, and setting a value back to the pack's makes it adopted again", () => {
    const set = applyRuling(commerce, undefined, "C-SHIP-1", { action: "set", parameters: { flatFeeUsd: 9.95 }, reason: "Our rate" }, "Sally", "2026-10-30");
    expect(set).toMatchObject({ binding: "overridden", status: "confirmed", version: 1 });
    const back = applyRuling(commerce, set, "C-SHIP-1", { action: "set", parameters: { flatFeeUsd: 7.95 }, reason: "Match the pack" }, "Sally", "2026-10-31");
    expect(back).toMatchObject({ binding: "adopted", version: 2 });
  });

  it("drops a retired policy from the book", () => {
    const retired = applyRuling(commerce, undefined, "C-SHIP-2", { action: "retire", reason: "We ship same day" }, "Sally", "2026-10-30");
    expect(assembleBook(commerce, [retired]).some((p) => p.key === "C-SHIP-2")).toBe(false);
  });
});
