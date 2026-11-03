import { describe, expect, it } from "vitest";

import { graphAt, graphMoments, layerAt, policyHistory, restoreVersion, type CradleHistory, type PolicyVersion } from "./cradle-graph";
import { PACKS } from "./cradle-packs";

const pack = PACKS.commerce;
const T = (h: number) => `2026-11-0${h < 24 ? 1 : 2}T${String(h % 24).padStart(2, "0")}:00:00.000Z`;

// C-SHIP-1: found at $9.95 by the ingest (09:00), set back to $7.95 by Sally (12:00).
const v1: PolicyVersion = { key: "C-SHIP-1", version: 1, from: T(9), to: T(12), by: "Policy Extractor", body: { key: "C-SHIP-1", binding: "overridden", status: "unreviewed", version: 1, parameters: { flatFeeUsd: 9.95 } } };
const v2: PolicyVersion = { key: "C-SHIP-1", version: 2, from: T(12), to: null, by: "Sally", body: { key: "C-SHIP-1", binding: "adopted", status: "confirmed", version: 2, parameters: { flatFeeUsd: 7.95 } } };
const own: PolicyVersion = { key: "S-ASSIST-1", version: 1, from: T(9), to: null, by: "Policy Extractor", body: { key: "S-ASSIST-1", binding: "site", status: "unreviewed", version: 1, concept: "assistant", event: "answer", title: "Assistant says no orders", statement: "The assistant says shoppers can't order." } };

const history: CradleHistory = {
  pack,
  startedAt: T(8),
  versions: [v1, v2, own],
  conflicts: [{ id: "c1", kind: "surface", keys: ["S-ASSIST-1", "C-CHK-1"], why: "Buy now is live.", status: "resolved", ruling: "Shoppers can order.", createdAt: T(9), ruledAt: T(11) }],
  alignments: [{ id: "ALIGN-1", decision: "ruling", sentence: "Shoppers can order.", keys: ["S-ASSIST-1", "C-CHK-1"], concepts: ["assistant"], context: "c", by: "Sally", at: T(11), work: { number: 12, stage: "build", released: false } }],
};

describe("the graph at a moment", () => {
  it("is empty before the cradle started", () => {
    expect(graphAt(history, T(7)).nodes).toHaveLength(0);
  });

  it("takes each policy as it stood then", () => {
    expect(layerAt(history.versions, T(10)).find((p) => p.key === "C-SHIP-1")!.parameters).toEqual({ flatFeeUsd: 9.95 });
    expect(layerAt(history.versions, T(13)).find((p) => p.key === "C-SHIP-1")!.parameters).toEqual({ flatFeeUsd: 7.95 });
    const at10 = graphAt(history, T(10)).nodes.find((n) => n.id === "C-SHIP-1")!;
    expect(at10.policy).toMatchObject({ binding: "overridden", status: "unreviewed" });
    expect(graphAt(history, T(13)).nodes.find((n) => n.id === "C-SHIP-1")!.policy).toMatchObject({ binding: "adopted", status: "confirmed" });
  });

  it("shows the site's own policies only once they were found", () => {
    expect(graphAt(history, T(8)).nodes.some((n) => n.id === "S-ASSIST-1")).toBe(false);
    expect(graphAt(history, T(10)).nodes.some((n) => n.id === "S-ASSIST-1")).toBe(true);
  });

  it("shows a contradiction open until it was ruled, then resolved", () => {
    expect(graphAt(history, T(10)).edges.find((e) => e.kind === "conflicts_with")).toMatchObject({ open: true, ruling: null });
    expect(graphAt(history, T(11)).edges.find((e) => e.kind === "conflicts_with")).toMatchObject({ open: false, ruling: "Shoppers can order." });
  });

  it("links policies to their concept and kernel, holes to their concept, and decisions to their policies", () => {
    const g = graphAt(history, T(13));
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "C-CHK-1", target: "kernel:stripe-checkout", kind: "runs_through" }));
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "C-SHIP-1", target: "concept:shipping", kind: "governs" }));
    expect(g.nodes.some((n) => n.id === "hole:product/publish")).toBe(true);
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "decision:ALIGN-1", target: "S-ASSIST-1", kind: "decides" }));
    expect(graphAt(history, T(10)).nodes.some((n) => n.kind === "decision")).toBe(false);
  });
});

describe("a graph from what the crew found", () => {
  it("gives a concept or kernel the pack doesn't have its own node, so every edge has both ends", () => {
    const odd: PolicyVersion = { key: "S-OTHER-1", version: 1, from: T(9), to: null, by: "Policy Extractor", body: { key: "S-OTHER-1", binding: "site", status: "unreviewed", version: 1, concept: "other", event: "other", title: "Something else", statement: "x", kernel: "mystery-engine" } };
    const g = graphAt({ ...history, versions: [...history.versions, odd] }, T(13));
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has("concept:other") && ids.has("kernel:mystery-engine")).toBe(true);
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});

describe("the timeline", () => {
  it("stops at the start, the ingest, each ruling and each decision, in order", () => {
    const m = graphMoments(history);
    expect(m.map((x) => x.kind)).toEqual(["start", "ingest", "ruling", "decision", "ruling"]);
    expect(m[1]!.label).toBe("Ingest: 2 policies found or updated");
    expect(m.at(-1)!.label).toBe("Sally ruled on 1 policy");
  });

  it("lists a policy's versions newest first, and rolls back by writing the old content as the next version", () => {
    expect(policyHistory(history, "C-SHIP-1").map((v) => v.version)).toEqual([2, 1]);
    const back = restoreVersion(v2.body, v1, "Sally", T(14));
    expect(back).toMatchObject({ version: 3, parameters: { flatFeeUsd: 9.95 }, ruledBy: "Sally", reason: "Restored to version 1." });
  });
});
