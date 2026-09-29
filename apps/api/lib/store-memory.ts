import { canApprove, canShip, type Caller, type Site, type SiteRequest } from "@accelerator/domain";

import * as F from "./fixtures";
import type { AcceleratorStore } from "./store-types";
import { requestTitle, triage } from "./triage";

/**
 * The seeded demo tenant, in memory. Used when Supabase keys are absent.
 * Mutations last until the process restarts.
 */
export function createMemoryStore(): AcceleratorStore {
  const db = structuredClone({
    sites: F.SITES,
    requests: F.REQUESTS,
    changes: F.CHANGES,
    investigations: F.INVESTIGATIONS,
    skills: F.SKILLS,
    account: F.ACCOUNT,
    health: F.HEALTH,
  });
  const siteRequests = (siteId: string) => db.requests.filter((r) => r.siteId === siteId);
  const demoCaller = (): Caller => {
    const m = F.MEMBERS.find((x) => x.role === "operator")!;
    return { memberId: m.id, orgId: F.ORG.id, role: m.role, name: m.name };
  };

  return {
    kind: "memory",

    // Demo: everyone is the demo Operator of the one demo account.
    async access(_identity, idOrSlug) {
      const site = db.sites.find((s) => s.id === idOrSlug || s.slug === idOrSlug);
      return site ? { site, caller: demoCaller(), status: "active" as const } : undefined;
    },
    async memberships() {
      return [{ orgId: F.ORG.id, orgName: F.ORG.name, role: "operator" as const, status: "active" as const, sites: db.sites.map(({ id, slug, name, url }) => ({ id, slug, name, url })) }];
    },

    async bridge(site: Site) {
      const open = siteRequests(site.id).filter((r) => r.stage !== "done" && r.stage !== "watch");
      return {
        site,
        gauges: { ...F.GAUGES, openRequests: open.length },
        needsYou: F.NEEDS_YOU,
        signals: F.SIGNALS,
        inFlight: siteRequests(site.id).filter((r) => r.stage !== "new" && r.stage !== "done"),
        recentReleases: F.RELEASES.slice(0, 3),
      };
    },
    async requests(siteId) {
      return siteRequests(siteId).sort((a, b) => b.number - a.number);
    },
    async createRequest(siteId, text, source) {
      const number = Math.max(0, ...db.requests.map((r) => r.number)) + 1;
      const req: SiteRequest = {
        id: `req_${number}`,
        number,
        siteId,
        title: requestTitle(text),
        detail: "The engine is reading this and will ask any questions here.",
        ...triage(text),
        priority: "now",
        stage: "clarify",
        source,
        createdAt: new Date().toISOString(),
      };
      db.requests.push(req);
      return req;
    },

    async changes(siteId) {
      return db.changes.filter((c) => c.siteId === siteId);
    },
    async change(siteId, id) {
      return db.changes.find((c) => c.siteId === siteId && c.id === id);
    },
    async approveChange(siteId, id, checked, caller) {
      const change = db.changes.find((c) => c.siteId === siteId && c.id === id);
      if (!change) return { ok: false, error: "Change not found.", status: 404 };
      if (!canApprove(caller.role, change.risk)) return { ok: false, error: "Your role can't approve this change. Ask the site Owner.", status: 403 };
      if (!change.checklist.every((s) => checked.includes(s.id))) return { ok: false, error: "Finish the checklist before approving.", status: 422 };

      change.approvals.push({ by: caller.name, role: caller.role, at: new Date().toISOString() });
      const check = canShip({ risk: change.risk, level: change.level, evidence: change.evidence, tried: true, approvals: change.approvals });
      if (check.canShip) {
        change.stage = "ship";
        const req = db.requests.find((r) => r.changeId === change.id);
        if (req) req.stage = "ship";
      }
      return { ok: true, change, blockers: check.blockers };
    },

    async dataDesk() {
      return { investigations: db.investigations, checks: F.DATA_CHECKS };
    },
    async library() {
      return { docs: F.DOCS, facts: F.FACTS, drift: F.DRIFT };
    },
    async doc(_siteId, id) {
      return F.DOCS.find((d) => d.id === id);
    },
    async consultations() {
      return F.CONSULTATIONS;
    },
    async releases() {
      return F.RELEASES;
    },
    async proof() {
      return F.PROOF;
    },

    async health() {
      return db.health;
    },
    async recordLighthouse(_site, scores) {
      db.health.lighthouse = [scores, ...db.health.lighthouse.filter((l) => l.page !== scores.page)];
      return scores;
    },

    async configuration() {
      return F.CONFIGURATION;
    },
    async skills() {
      return db.skills;
    },
    async toggleSkill(_siteId, id, enabled) {
      const skill = db.skills.find((s) => s.id === id);
      if (skill) skill.enabled = enabled;
      return skill;
    },

    async account() {
      return db.account;
    },
    async setLimits(_orgId, input) {
      if (typeof input.dailyCapUsd === "number") db.account.dailyCapUsd = input.dailyCapUsd;
      for (const l of input.limits ?? []) {
        const meter = db.account.meters.find((m) => m.model === l.model);
        if (meter) meter.limitUsd = l.limitUsd;
      }
      return db.account;
    },

    async codeTree() {
      return F.FILE_TREE;
    },
    async codeFile(_siteId, path) {
      return F.FILE_CONTENTS[path] ?? `// ${path}\n// File contents stream from the site's repository in the full product.\n`;
    },
  };
}
