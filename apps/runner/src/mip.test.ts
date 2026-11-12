import { describe, expect, it } from "vitest";

import { candidateText, packContext, type Candidate } from "./mip";

const candidate: Candidate = {
  id: "LIMITS:21",
  program: "LIMITS",
  file: "LIMITS.cbl",
  line: 21,
  outcome: [{ field: "COMM-FAIL", line: 22, value: "8" }],
  applies_when: [{ line: 20, condition: "WS-COUNT > 9", kind: "if" }],
  decided_by: { "WS-COUNT": [{ program: "LIMITS", line: 15, how: "EXEC SQL SELECT", origin: ["db2:ACCOUNT"] }] },
  reached_from: [],
  returned_to: [],
  review: [{ kind: "runtime_value", question: "Which values can X take?", evidence: [], status: "needs review" }],
  source: { "LIMITS.cbl": [[20, "    IF WS-COUNT > 9"], [22, "       MOVE '8' TO COMM-FAIL"]] },
};

// MIP P4 (mip.md M8): the model reads the reader's trace as fact and the cited source as written.
describe("rule review input", () => {
  it("gives the trace without the source, then each cited line under its file", () => {
    const text = candidateText(candidate);
    const [trace, source] = text.split("Source lines cited:");
    expect(trace).toContain('"WS-COUNT > 9"');
    expect(trace).toContain("Which values can X take?");
    expect(trace).not.toContain('"source"');
    expect(source).toContain("--- LIMITS.cbl\n   20      IF WS-COUNT > 9\n   22         MOVE '8' TO COMM-FAIL");
  });

  it("lists the pack's concepts and policies, or says there is no pack", () => {
    const cards = packContext("cards");
    expect(cards).toContain("Industry pack: Cards");
    expect(cards).toContain("- authorization: Authorization");
    expect(cards).toContain("CC-AUTH-1 [authorization/decline, critical] Decline over the credit limit");
    expect(packContext(null)).toMatch(/No industry pack/);
  });
});
