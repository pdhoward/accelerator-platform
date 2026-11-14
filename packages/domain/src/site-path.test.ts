import { describe, expect, it } from "vitest";

import { brief } from "./prompts";
import { isSitePath, sitePathOf } from "./types";
import type { JobContext } from "./flywheel";

const ctx = (path?: "modernize" | "transform") =>
  ({
    job: { kind: "discuss" },
    site: { id: "s", slug: "blog", name: "Blog", url: "https://blog.example.com", repoPath: null, baseBranch: "stage", stack: null, baselineTests: null, repo: null, domain: null, path },
    work: null,
    toolbeltToken: null,
  }) as unknown as JobContext;

describe("site path (B31)", () => {
  it("reads leniently: a site from before migration 0021 was registered for the Cradle", () => {
    expect(sitePathOf("modernize")).toBe("modernize");
    expect(sitePathOf(undefined)).toBe("transform");
    expect(sitePathOf("other")).toBe("transform");
    expect(isSitePath("modernize")).toBe(true);
    expect(isSitePath("cradle")).toBe(false);
  });

  it("tells the crew a Modernize site stays a coded app", () => {
    expect(brief(ctx("modernize"))).toMatch(/Path: Modernize/);
    expect(brief(ctx("transform"))).not.toMatch(/Path:/);
    expect(brief(ctx())).not.toMatch(/Path:/);
  });
});

describe("commit author (migration 0022)", () => {
  it("accepts a plain name and email, never shell characters", async () => {
    const { isCommitAuthor } = await import("./flywheel");
    expect(isCommitAuthor({ name: "Site Owner", email: "owner@example.com" })).toBe(true);
    expect(isCommitAuthor({ name: 'a" && rm', email: "owner@example.com" })).toBe(false);
    expect(isCommitAuthor({ name: "Owner", email: "o$x@example.com" })).toBe(false);
    expect(isCommitAuthor(null)).toBe(false);
  });
});
