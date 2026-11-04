import { describe, expect, it } from "vitest";

import { githubRepo } from "./types";

describe("a code repository, from what people paste", () => {
  it("reads a GitHub URL, an SSH remote or the short form as owner/name", () => {
    expect(githubRepo("https://github.com/aws-samples/aws-mainframe-modernization-carddemo")).toBe("aws-samples/aws-mainframe-modernization-carddemo");
    expect(githubRepo("https://github.com/altitude80ai/awscarddemo.git")).toBe("altitude80ai/awscarddemo");
    expect(githubRepo("github.com/pdhoward/machineshop/")).toBe("pdhoward/machineshop");
    expect(githubRepo("git@github.com:pdhoward/machineshop.git")).toBe("pdhoward/machineshop");
    expect(githubRepo(" pdhoward/machineshop ")).toBe("pdhoward/machineshop");
  });

  it("refuses what isn't a repository", () => {
    expect(githubRepo("https://gitlab.com/a/b/c")).toBeNull();
    expect(githubRepo("machineshop")).toBeNull();
    expect(githubRepo("")).toBeNull();
    expect(githubRepo(null)).toBeNull();
  });
});
