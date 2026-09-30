import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { nestTree } from "./github";
import { last4, open, seal } from "./vault";

describe("vault encryption", () => {
  const k = randomBytes(32);
  it("round-trips a value, with a fresh IV every time", () => {
    const a = seal("mongodb+srv://user:secret@cluster0/", k);
    const b = seal("mongodb+srv://user:secret@cluster0/", k);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(open(a, k)).toBe("mongodb+srv://user:secret@cluster0/");
  });
  it("refuses a tampered value or the wrong key", () => {
    const s = seal("sk_test_123", k);
    const flipped = Buffer.from(s.ciphertext, "base64");
    flipped[0]! ^= 1;
    expect(() => open({ ...s, ciphertext: flipped.toString("base64") }, k)).toThrow();
    expect(() => open(s, randomBytes(32))).toThrow();
  });
  it("shows only the last four characters", () => {
    expect(last4("sk_test_abcd1234")).toBe("••••1234");
    expect(last4("abc")).toBe("••••");
  });
});

describe("nestTree", () => {
  it("builds full-depth folders first, alphabetical", () => {
    const tree = nestTree([
      { path: "package.json", type: "blob" },
      { path: "lib", type: "tree" },
      { path: "lib/product.ts", type: "blob" },
      { path: "app", type: "tree" },
      { path: "app/p", type: "tree" },
      { path: "app/p/[id]", type: "tree" },
      { path: "app/p/[id]/page.tsx", type: "blob" },
      { path: "vendor", type: "commit" },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["app", "lib", "package.json"]);
    expect(tree[0]!.children![0]!.children![0]!.children![0]).toMatchObject({ path: "app/p/[id]/page.tsx", type: "file" });
  });
});
