import { describe, expect, it } from "vitest";

import { agentEnv, FORBIDDEN, refusal, SECRET_FILE } from "./models";
import { codeHome, githubAuthEnv, isTestFile } from "./repo";
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

describe("agents never hold the runner's keys (gen2-crew.md §1.2)", () => {
  const runner = {
    PATH: "/usr/bin", HOME: "/home/r", TEMP: "/tmp", SystemRoot: "C:\Windows",
    ANTHROPIC_API_KEY: "sk-ant-model", ANTHROPIC_WORKSPACE_ID: "ws",
    RUNNER_TOKEN: "runner-secret", VAULT_KEY: "vault", GITHUB_TOKEN: "ghp", SUPABASE_SECRET_KEY: "sb", OPENAI_API_KEY: "sk-oai", TOOLBELT_SECRET: "tb",
  };
  it("passes the system essentials, the model's own key and the site's test values, nothing else", () => {
    const env = agentEnv(runner, { MONGODB_URI: "mongodb://test-copy" });
    expect(Object.keys(env).sort()).toEqual(["ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID", "HOME", "MONGODB_URI", "PATH", "SystemRoot", "TEMP"].sort());
    for (const k of ["RUNNER_TOKEN", "VAULT_KEY", "GITHUB_TOKEN", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "TOOLBELT_SECRET"]) expect(env[k]).toBeUndefined();
  });
  it("with the model proxy (G2.2b), holds no model key at all: only the API's address and the job token", () => {
    const env = agentEnv(runner, { MONGODB_URI: "mongodb://test-copy", ANTHROPIC_API_KEY: "sk-ant-from-the-site" }, { url: "https://api.example/model", token: "job-token" });
    expect(env.ANTHROPIC_API_KEY).toBe("job-token");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.example/model");
    expect(env.ANTHROPIC_WORKSPACE_ID).toBeUndefined();
    expect(Object.values(env)).not.toContain("sk-ant-model");
    expect(Object.values(env)).not.toContain("sk-ant-from-the-site");
    expect(env.MONGODB_URI).toBe("mongodb://test-copy");
  });
  it("refuses dumping or echoing the environment, but not ordinary commands", () => {
    const refused = (cmd: string) => FORBIDDEN.some(([re]) => re.test(cmd));
    for (const cmd of ["printenv", "env", "env | grep KEY", "set", "export -p", "echo $ANTHROPIC_API_KEY", "echo ${GITHUB_TOKEN}", 'node -e "console.log(process.env)"', "cat /proc/self/environ", "Get-ChildItem env:", "$env:ANTHROPIC_API_KEY"]) {
      expect(refused(cmd)).toBe(true);
    }
    for (const cmd of ["pnpm test", "pnpm typecheck", "set -e", "env NODE_ENV=test pnpm test", "echo done", "npx vitest run lib/rules.test.ts"]) {
      expect(refused(cmd)).toBe(false);
    }
  });
});

// A hosted runner has no local copies: it clones from GitHub, and the token never lands on disk.
describe("codeHome", () => {
  const has = (dirs: string[]) => (d: string) => dirs.includes(d);
  it("uses the local copy when this machine has one", () => {
    expect(codeHome("C:\code\carddemo", "github.com/aws-samples/carddemo", has(["C:\code\carddemo"]))).toEqual({ dir: "C:\code\carddemo", clone: null });
  });
  it("clones from GitHub when the local copy is blank or missing", () => {
    for (const path of [null, "", "C:\nowhere"]) {
      const home = codeHome(path, "https://github.com/aws-samples/aws-mainframe-modernization-carddemo.git", has([]));
      expect(home?.clone).toBe("aws-samples/aws-mainframe-modernization-carddemo");
      expect(home?.dir).toMatch(/aws-samples__aws-mainframe-modernization-carddemo$/);
    }
  });
  it("has nothing when there is neither", () => {
    expect(codeHome(null, null, has([]))).toBeNull();
    expect(codeHome("", "not a repo", has([]))).toBeNull();
  });
});

describe("githubAuthEnv", () => {
  it("sends the token as a github.com header, never in a URL", () => {
    const env = githubAuthEnv("ghp_example");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${Buffer.from("x-access-token:ghp_example").toString("base64")}`);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });
  it("adds nothing without a token (public repositories)", () => {
    expect(githubAuthEnv(undefined)).toEqual({ GIT_TERMINAL_PROMPT: "0" });
  });
});

// Every tool call passes this guard (a PreToolUse hook), pre-approved tools included.
describe("refusal", () => {
  it("refuses key files to every file tool", () => {
    for (const tool of ["Read", "Grep", "Glob", "Write", "Edit"]) expect(refusal(tool, { file_path: "C:/w/work-11/.env.local", path: "C:/w/work-11/.env.local" })).toMatch(/Keys/);
    expect(refusal("Glob", { pattern: "**/.env*" })).toMatch(/Keys/);
  });
  it("lets ordinary files and the key list through", () => {
    expect(refusal("Read", { file_path: "app/order/success/page.tsx" })).toBeNull();
    expect(refusal("Read", { file_path: ".env.example" })).toBeNull();
  });
  it("refuses forbidden commands", () => {
    expect(refusal("Bash", { command: "git merge --ff-only main" })).toMatch(/Work stays/);
    expect(refusal("Bash", { command: "git push origin work/11" })).toMatch(/runner pushes/);
    expect(refusal("Bash", { command: "pnpm test" })).toBeNull();
  });
});
