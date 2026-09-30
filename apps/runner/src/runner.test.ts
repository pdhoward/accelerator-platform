import { describe, expect, it } from "vitest";

import { FORBIDDEN, SECRET_FILE } from "./models";
import { isTestFile } from "./repo";
import { parseManifest, parseTests } from "./sh";

// These decide the Protocol verdict, so they're tested like money rules.
describe("parseTests", () => {
  it("reads vitest summaries, passing and failing", () => {
    expect(parseTests(" Test Files  1 passed (1)\n      Tests  9 passed (9)\n")).toEqual({ passed: 9, failed: 0, total: 9 });
    expect(parseTests("      Tests  1 failed | 13 passed (14)")).toEqual({ passed: 13, failed: 1, total: 14 });
    expect(parseTests("\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m32 passed\x1b[39m\x1b[22m\x1b[90m (32)\x1b[39m")).toEqual({ passed: 32, failed: 0, total: 32 });
  });
  it("reads jest summaries", () => {
    expect(parseTests("Tests:       2 failed, 40 passed, 42 total")).toEqual({ passed: 40, failed: 2, total: 42 });
  });
  it("returns null when no suite ran", () => {
    expect(parseTests("ERR_PNPM_NO_SCRIPT Missing script: test")).toBeNull();
  });
});

describe("isTestFile", () => {
  it("recognizes test files and folders", () => {
    for (const f of ["lib/product.test.ts", "src/a.spec.tsx", "__tests__/x.ts", "tests/e2e/shop.ts"]) expect(isTestFile(f)).toBe(true);
    for (const f of ["lib/product.ts", "app/page.tsx", "latest.ts"]) expect(isTestFile(f)).toBe(false);
  });
});

describe("builder guard", () => {
  const refused = (cmd: string) => FORBIDDEN.some(([re]) => re.test(cmd));
  it("refuses publishing, leaving the branch, git bookkeeping and secrets", () => {
    for (const c of ["git push origin work/1", "git checkout main", "git merge stage", "git commit -m x", "cat .env.local", "vercel deploy --prod", "rm -rf /"]) {
      expect(refused(c), c).toBe(true);
    }
  });
  it("allows normal work", () => {
    for (const c of ["pnpm test", "pnpm typecheck", "git status", "git diff", "cat .env.example", "ls lib"]) expect(refused(c), c).toBe(false);
  });
});

it("guards key files but not the .env.example manifest", () => {
  for (const f of [".env", ".env.local", "C:/site/.env.development.local", "apps/web/.env"]) expect(SECRET_FILE.test(f), f).toBe(true);
  for (const f of [".env.example", "lib/environment.ts", "README.md"]) expect(SECRET_FILE.test(f), f).toBe(false);
});

it("reads .env.example into the site's key list, with purpose and where-to-find", () => {
  const m = parseManifest(`# Machine Shop: every key the site needs.

# Product catalog (MongoDB, read-only). Where: MongoDB Atlas → Database → Connect → Drivers.
MONGODB_URI=
MONGODB_DB=openai

# Shop assistant (optional). Where: console.anthropic.com → API keys.
ANTHROPIC_API_KEY=
`);
  expect(m.map((x) => x.key)).toEqual(["MONGODB_URI", "MONGODB_DB", "ANTHROPIC_API_KEY"]);
  expect(m[0]).toEqual({ key: "MONGODB_URI", purpose: "Product catalog (MongoDB, read-only).", howToGet: "MongoDB Atlas → Database → Connect → Drivers." });
  expect(m[1]!.purpose).toBe("");
  expect(m[2]!.howToGet).toBe("console.anthropic.com → API keys.");
});
