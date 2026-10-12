import { describe, expect, it } from "vitest";

import { canPartner, canPlatform, PARTNER_ACTIONS } from "./permissions";
import { holdsGates, resolveSiteAccess, SUPPORT_GRANT_MAX_HOURS, supportGrantLive, supportGrantWindow } from "./tenancy";

const none = { memberRole: null, partnerRole: null, supportGrant: false } as const;

describe("resolveSiteAccess", () => {
  it("gives a member their own role", () => {
    expect(resolveSiteAccess({ ...none, memberRole: "owner" })).toEqual({ role: "owner", via: "member" });
    expect(resolveSiteAccess({ ...none, memberRole: "viewer" })).toEqual({ role: "viewer", via: "member" });
  });

  it("prefers membership over the partner seat and a support grant", () => {
    expect(resolveSiteAccess({ memberRole: "tester", partnerRole: "owner", supportGrant: true })).toEqual({ role: "tester", via: "member" });
  });

  it("gives every partner role Operator on the partner's clients", () => {
    for (const partnerRole of ["owner", "admin", "operator"] as const) {
      expect(resolveSiteAccess({ ...none, partnerRole })).toEqual({ role: "operator", via: "partner" });
    }
  });

  it("prefers the partner seat over a support grant", () => {
    expect(resolveSiteAccess({ ...none, partnerRole: "operator", supportGrant: true })?.via).toBe("partner");
  });

  it("gives a support grant Operator", () => {
    expect(resolveSiteAccess({ ...none, supportGrant: true })).toEqual({ role: "operator", via: "support" });
  });

  it("refuses everyone else: no standing platform bypass", () => {
    expect(resolveSiteAccess(none)).toBeNull();
  });
});

describe("holdsGates", () => {
  it("is true only for the account's own people", () => {
    expect(holdsGates({ via: "member" })).toBe(true);
    expect(holdsGates({ via: "partner" })).toBe(false);
    expect(holdsGates({ via: "support" })).toBe(false);
  });
});

describe("partner permissions", () => {
  it("owner holds every action; admin all but team; operator only view and operate", () => {
    for (const a of PARTNER_ACTIONS) expect(canPartner("owner", a)).toBe(true);
    expect(canPartner("admin", "team.manage")).toBe(false);
    expect(canPartner("admin", "clients.create")).toBe(true);
    expect(canPartner("operator", "clients.operate")).toBe(true);
    expect(canPartner("operator", "brand.manage")).toBe(false);
    expect(canPartner(null, "partner.view")).toBe(false);
  });

  it("lets platform owners and admins grant support, not staff", () => {
    expect(canPlatform("owner", "support.grant")).toBe(true);
    expect(canPlatform("admin", "support.grant")).toBe(true);
    expect(canPlatform("staff", "support.grant")).toBe(false);
  });
});

describe("support grants", () => {
  const now = new Date("2026-10-12T12:00:00Z");

  it("needs a reason and at least an hour", () => {
    expect(supportGrantWindow(4, "  ", now)).toEqual({ error: "Give a reason for the support access." });
    expect(supportGrantWindow(0, "debugging", now)).toEqual({ error: "Support access lasts at least one hour." });
    expect(supportGrantWindow(Number.NaN, "debugging", now)).toHaveProperty("error");
  });

  it("caps the window at the maximum", () => {
    const w = supportGrantWindow(500, "migration help", now);
    if ("error" in w) throw new Error(w.error);
    expect(w.expiresAt.getTime() - now.getTime()).toBe(SUPPORT_GRANT_MAX_HOURS * 3_600_000);
  });

  it("is live until it expires or is revoked", () => {
    const expiresAt = new Date(now.getTime() + 3_600_000);
    expect(supportGrantLive({ expiresAt, revokedAt: null }, now)).toBe(true);
    expect(supportGrantLive({ expiresAt, revokedAt: now }, now)).toBe(false);
    expect(supportGrantLive({ expiresAt: now, revokedAt: null }, now)).toBe(false);
  });
});
