import { describe, expect, it } from "vitest";

import { classifyModelError, modelHealth, redactSecrets, type ModelFault } from "./model-health";

const now = new Date("2026-11-10T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const fault = (over: Partial<ModelFault>): ModelFault => ({ source: "app", kind: "billing", role: "search", model: "claude-haiku-5-5", message: "x", at: ago(5), ...over });

describe("classifyModelError", () => {
  it("reads the provider's own words", () => {
    expect(classifyModelError("400 Your credit balance is too low to access the Anthropic API.", 400)).toBe("billing");
    expect(classifyModelError("You exceeded your current quota", 429)).toBe("billing");
    expect(classifyModelError("invalid x-api-key", 401)).toBe("auth");
    expect(classifyModelError("not_found_error: model: claude-nope", 404)).toBe("model");
    expect(classifyModelError("rate_limit_error", 429)).toBe("rate_limit");
    expect(classifyModelError("Overloaded", 529)).toBe("overloaded");
    expect(classifyModelError("Connection error.", null)).toBe("unavailable");
    expect(classifyModelError("anthropic 503: request failed", undefined)).toBe("unavailable");
  });
  it("leaves our own errors alone", () => {
    expect(classifyModelError("Unexpected token } in JSON at position 4")).toBeNull();
    expect(classifyModelError("The model declined this request.")).toBeNull();
    expect(classifyModelError("max_tokens: must be positive", 400)).toBeNull();
  });
});

describe("redactSecrets", () => {
  it("masks keys", () => {
    expect(redactSecrets("Incorrect API key provided: sk-proj-abc123XYZ789. Find yours")).toBe("Incorrect API key provided: sk-…. Find yours");
    expect(redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc")).toBe("Authorization: Bearer …");
  });
});

describe("modelHealth", () => {
  it("is down on a lasting fault until a call succeeds", () => {
    const h = modelHealth({ faults: [fault({})], successes: [{ source: "app", at: ago(60) }], now });
    expect(h.status).toBe("down");
    expect(h.headline).toBe("AI unavailable: the running app — out of credit");
    expect(h.sources[0]!.fault?.fix).toMatch(/auto-reload/);
    const back = modelHealth({ faults: [fault({})], successes: [{ source: "app", at: ago(1) }], now });
    expect(back.status).toBe("ok");
    expect(back.sources[0]!.recoveredAt).toBe(ago(1));
  });
  it("treats a passing fault as degraded only while fresh", () => {
    expect(modelHealth({ faults: [fault({ kind: "overloaded", at: ago(3) })], successes: [], now }).status).toBe("degraded");
    expect(modelHealth({ faults: [fault({ kind: "overloaded", at: ago(30) })], successes: [{ source: "app", at: ago(90) }], now }).status).toBe("ok");
  });
  it("reports the worst source and knows when nothing has run", () => {
    expect(modelHealth({ faults: [], successes: [], now }).status).toBe("unknown");
    const h = modelHealth({ faults: [fault({ source: "crew", kind: "auth" })], successes: [{ source: "app", at: ago(1) }], now });
    expect(h.status).toBe("down");
    expect(h.sources.map((s) => s.status)).toEqual(["ok", "down"]);
  });
});

describe("aiReading", () => {
  it("puts the fault and its fix on the Policy dial", async () => {
    const { aiReading } = await import("./cradle");
    const down = aiReading(modelHealth({ faults: [fault({})], successes: [], now }), { pack: null });
    expect(down.condition).toBe("attention");
    expect(down.state).toBe("Unavailable");
    expect(down.facts[1]).toMatch(/Add credit/);
    expect(aiReading(modelHealth({ faults: [], successes: [], now }), { pack: null }).condition).toBe("not_connected");
  });
});
