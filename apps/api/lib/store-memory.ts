import type { Caller, Site } from "@accelerator/domain";

import * as F from "./fixtures";
import type { AcceleratorStore } from "./store-types";

/**
 * The demo tenant (Example Machine Shop), in memory. Used when Supabase keys
 * are absent. Mutations last until the process restarts.
 */
export function createMemoryStore(): AcceleratorStore {
  const db = structuredClone({ sites: F.SITES, account: F.ACCOUNT, health: F.HEALTH });
  const demoCaller = (): Caller => {
    const m = F.MEMBERS.find((x) => x.role === "operator")!;
    return { memberId: m.id, orgId: F.ORG.id, role: m.role, name: m.name, via: "member", partnerName: F.HOUSE_PARTNER.name };
  };

  return {
    kind: "memory",

    // Demo: everyone is the demo Operator of the one demo account.
    async access(_identity, idOrSlug) {
      const site = db.sites.find((s) => s.id === idOrSlug || s.slug === idOrSlug);
      return site ? { site, caller: demoCaller(), status: "active" as const } : undefined;
    },
    async memberships() {
      return [
        {
          orgId: F.ORG.id,
          orgName: F.ORG.name,
          role: "operator" as const,
          status: "active" as const,
          via: "member" as const,
          partnerName: F.HOUSE_PARTNER.name,
          sites: db.sites.map(({ id, slug, name, url }) => ({ id, slug, name, url })),
        },
      ];
    },

    async bridge(site: Site) {
      return { site };
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
