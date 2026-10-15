import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Site } from "@accelerator/domain";
const mocks = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  demoMode: vi.fn(),
  access: vi.fn(),
  listWork: vi.fn(),
  workDetail: vi.fn(),
}));
vi.mock("./auth", () => ({
  resolveIdentity: mocks.resolveIdentity,
  demoMode: mocks.demoMode,
}));
vi.mock("./store", () => ({ store: { access: mocks.access } }));
vi.mock("./work", () => ({
  listWork: mocks.listWork,
  workDetail: mocks.workDetail,
}));
import { GET as briefing } from "../app/api/sites/[siteId]/briefing/route";
import { GET as studio } from "../app/api/sites/[siteId]/work/[number]/studio/route";
import { studioSample } from "./studio-sample";
const site: Site = {
  id: "authorized-site",
  orgId: "authorized-org",
  slug: "authorized",
  name: "Example",
  url: "https://example.com",
  repo: "example/site",
  stack: "TypeScript",
  status: "onboarding",
  lastReleaseAt: "",
  demo: true,
};
const identity = {
  userId: "user",
  email: "user@example.com",
  platformRole: null,
  partnerSeats: [],
};
function req(path = "briefing") {
  return new Request(`http://localhost/api/sites/authorized/${path}`);
}
function ctx(siteId = "authorized") {
  return { params: Promise.resolve({ siteId, number: "1" }) };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveIdentity.mockResolvedValue(identity);
  mocks.demoMode.mockReturnValue(false);
  mocks.access.mockResolvedValue({
    site,
    caller: { role: "viewer", via: "member" },
    status: "active",
  });
  mocks.listWork.mockResolvedValue([]);
  mocks.workDetail.mockResolvedValue(studioSample());
});
describe("workspace read endpoints enforce the existing tenant boundary", () => {
  it("requires authentication", async () => {
    mocks.resolveIdentity.mockResolvedValue(null);
    expect((await briefing(req(), ctx())).status).toBe(401);
    expect((await studio(req("work/1/studio"), ctx())).status).toBe(401);
    expect(mocks.listWork).not.toHaveBeenCalled();
  });
  it("does not disclose another tenant", async () => {
    mocks.access.mockResolvedValue(undefined);
    expect((await briefing(req(), ctx("other"))).status).toBe(404);
    expect((await studio(req(), ctx("other"))).status).toBe(404);
    expect(mocks.workDetail).not.toHaveBeenCalled();
  });
  it("blocks suspended access", async () => {
    mocks.access.mockResolvedValue({
      site,
      caller: { role: "viewer" },
      status: "suspended",
    });
    expect((await briefing(req(), ctx())).status).toBe(423);
  });
  it("reads only the resolved site and marks private responses no-store", async () => {
    const res = await briefing(req(), ctx("untrusted-slug"));
    expect(res.status).toBe(200);
    expect(mocks.listWork).toHaveBeenCalledWith("authorized-site");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).source).toBe("recorded");
  });
  it("a demo flag on a database-backed site never substitutes synthetic evidence", async () => {
    const res = await studio(req(), ctx());
    expect(mocks.workDetail).toHaveBeenCalledWith(site, 1);
    expect((await res.json()).studio.source).toBe("recorded");
  });
  it("serves clearly labelled synthetic read-only records only in the keyless demo", async () => {
    mocks.demoMode.mockReturnValue(true);
    const res = await studio(req(), ctx());
    expect((await res.json()).studio.source).toBe("sample");
    expect(mocks.workDetail).not.toHaveBeenCalled();
    expect((await (await briefing(req(), ctx())).json()).source).toBe("sample");
  });
  it("rejects invalid work numbers before reading Work records", async () => {
    for (const number of ["NaN", "-1", "1.5", "0", "9007199254740992"]) {
      expect(
        (
          await studio(req(), {
            params: Promise.resolve({ siteId: "authorized", number }),
          })
        ).status,
      ).toBe(400);
    }
    expect(mocks.workDetail).not.toHaveBeenCalled();
  });
});
