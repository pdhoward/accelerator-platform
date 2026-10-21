import type { AccountStatus, Account, Bridge, Caller, Configuration, FileNode, Health, Identity, LighthouseScores, Membership, Site } from "@accelerator/domain";

/**
 * Everything the API needs from storage. Two implementations:
 * store-memory.ts (seeded demo tenant, no keys needed) and store-supabase.ts
 * (the real multi-tenant database). lib/store.ts picks one from the environment.
 */
export interface AcceleratorStore {
  readonly kind: "memory" | "supabase";

  /**
   * The site (by id or slug) if the identity is a member of its account: the
   * site, the caller's role there, and the account's status. Otherwise undefined.
   */
  access(identity: Identity, idOrSlug: string): Promise<{ site: Site; caller: Caller; status: AccountStatus } | undefined>;
  memberships(identity: Identity): Promise<Membership[]>;

  bridge(site: Site): Promise<Bridge>;

  health(siteId: string): Promise<Health>;
  recordLighthouse(site: Site, scores: LighthouseScores): Promise<LighthouseScores>;

  configuration(siteId: string): Promise<Configuration>;

  account(orgId: string): Promise<Account>;
  setLimits(orgId: string, input: { dailyCapUsd?: number; limits?: { model: string; limitUsd: number }[] }): Promise<Account>;

  codeTree(siteId: string): Promise<FileNode[]>;
  codeFile(siteId: string, path: string): Promise<string>;
}
