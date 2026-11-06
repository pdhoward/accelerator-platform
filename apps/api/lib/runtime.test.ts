import { afterEach, describe, expect, it } from "vitest";

import { mintRuntimeToken, verifyRuntimeToken } from "./runtime";

describe("site runtime tokens", () => {
  const saved = process.env.CRADLE_RUNTIME_SECRET;
  afterEach(() => {
    process.env.CRADLE_RUNTIME_SECRET = saved;
  });
  it("round-trips the site it names", () => {
    process.env.CRADLE_RUNTIME_SECRET = "test-secret";
    const t = mintRuntimeToken("8f2c1a9e-0000-4000-8000-000000000001");
    expect(verifyRuntimeToken(t)).toBe("8f2c1a9e-0000-4000-8000-000000000001");
  });
  it("refuses a token pointed at another site, a forged one, and junk", () => {
    process.env.CRADLE_RUNTIME_SECRET = "test-secret";
    const t = mintRuntimeToken("site-a");
    expect(verifyRuntimeToken(t.replace("site-a", "site-b"))).toBeNull();
    expect(verifyRuntimeToken(`${t.slice(0, -2)}xx`)).toBeNull();
    expect(verifyRuntimeToken("Bearer nonsense")).toBeNull();
    expect(verifyRuntimeToken(null)).toBeNull();
  });
  it("is revoked when the secret rotates", () => {
    process.env.CRADLE_RUNTIME_SECRET = "one";
    const t = mintRuntimeToken("site-a");
    process.env.CRADLE_RUNTIME_SECRET = "two";
    expect(verifyRuntimeToken(t)).toBeNull();
  });
});
