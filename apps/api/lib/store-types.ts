import type {
  Account,
  Bridge,
  Caller,
  Change,
  Configuration,
  Consultation,
  DataCheck,
  DataInvestigation,
  Doc,
  Drift,
  Fact,
  FileNode,
  Health,
  LighthouseScores,
  Proof,
  Release,
  Site,
  SiteRequest,
  Skill,
} from "@accelerator/domain";

export type ApproveResult =
  | { ok: false; error: string; status: 403 | 404 | 422 }
  | { ok: true; change: Change; blockers: string[] };

/**
 * Everything the API needs from storage. Two implementations:
 * store-memory.ts (seeded demo tenant, no keys needed) and store-supabase.ts
 * (the real multi-tenant database). lib/store.ts picks one from the environment.
 */
export interface AcceleratorStore {
  readonly kind: "memory" | "supabase";

  demoCaller(): Promise<Caller>;
  sites(orgId: string): Promise<Site[]>;
  /** Only returns a site that belongs to orgId. Accepts the site's id or slug. */
  site(orgId: string, idOrSlug: string): Promise<Site | undefined>;

  bridge(site: Site): Promise<Bridge>;
  requests(siteId: string): Promise<SiteRequest[]>;
  createRequest(siteId: string, text: string, source: string, caller: Caller): Promise<SiteRequest>;

  changes(siteId: string): Promise<Change[]>;
  change(siteId: string, id: string): Promise<Change | undefined>;
  approveChange(siteId: string, id: string, checked: string[], caller: Caller): Promise<ApproveResult>;

  dataDesk(siteId: string): Promise<{ investigations: DataInvestigation[]; checks: DataCheck[] }>;
  library(siteId: string): Promise<{ docs: Doc[]; facts: Fact[]; drift: Drift[] }>;
  doc(siteId: string, id: string): Promise<Doc | undefined>;
  consultations(siteId: string): Promise<Consultation[]>;
  releases(siteId: string): Promise<Release[]>;
  proof(siteId: string): Promise<Proof>;

  health(siteId: string): Promise<Health>;
  recordLighthouse(site: Site, scores: LighthouseScores): Promise<LighthouseScores>;

  configuration(siteId: string): Promise<Configuration>;
  skills(siteId: string): Promise<Skill[]>;
  toggleSkill(siteId: string, id: string, enabled: boolean): Promise<Skill | undefined>;

  account(orgId: string): Promise<Account>;
  setLimits(orgId: string, input: { dailyCapUsd?: number; limits?: { model: string; limitUsd: number }[] }): Promise<Account>;

  codeTree(siteId: string): Promise<FileNode[]>;
  codeFile(siteId: string, path: string): Promise<string>;
}
