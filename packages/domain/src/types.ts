/**
 * The Control Room's vocabulary. Shared by apps/api (which produces these)
 * and apps/console (which renders them) via packages/api-client.
 */

// ── Tenancy ───────────────────────────────────────────────────────────────
export type Role = "owner" | "operator" | "tester" | "viewer";

/** Platform staff roles (Platform Admin area). */
export type PlatformRole = "owner" | "admin" | "staff";

export type AccountStatus = "invited" | "onboarding" | "active" | "past_due" | "suspended" | "cancelled";

export type BillingMode = "stripe" | "invoiced" | "comped";

export type Member = { id: string; name: string; email: string; role: Role };

export type Org = { id: string; name: string; plan: PlanId };

export type Site = {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  url: string;
  repo: string;
  stack: string;
  status: "live" | "onboarding";
  /** A seeded demo tenant: the only kind of site that shows sample data. */
  demo?: boolean;
  lastReleaseAt: string;
};

// ── Partners (gen2-crew.md §5): Platform → Partner → Company → Site ─────────
/** A partner firm's own team. The house partner (Strategic Machines Direct) has one too. */
export type PartnerRole = "owner" | "admin" | "operator";

export type PartnerKind = "house" | "partner";

export type PartnerTier = "silver" | "gold" | "platinum";

/** How a partner's crews look to its clients: named (Silver), co-branded (Gold), white-labelled (Platinum). */
export type PartnerBrand = { crewName?: string; logoUrl?: string; colors?: Record<string, string>; domain?: string };

export type Partner = {
  id: string;
  slug: string;
  name: string;
  kind: PartnerKind;
  tier: PartnerTier | null;
  status: "active" | "suspended";
  brand: PartnerBrand;
};

/** Time-boxed platform access to one account, or to all of one partner's accounts. */
export type SupportGrant = {
  id: string;
  grantedToEmail: string;
  orgId: string | null;
  partnerId: string | null;
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

/** A seat on a partner's team, carried on the identity. */
export type PartnerSeat = { partnerId: string; partnerName: string; role: PartnerRole };

/**
 * How a caller reaches a site: as one of the account's own people (`member`),
 * as its partner's team (`partner`), or under a platform support grant
 * (`support`). Only members hold the account's gates (tenancy.ts holdsGates).
 */
export type AccessVia = "member" | "partner" | "support";

/** Who is acting on a site. `partnerName` labels partner and support callers. */
export type Caller = { memberId: string; orgId: string; role: Role; name: string; via: AccessVia; partnerName?: string };

/** A signed-in person, before any account is chosen. */
export type Identity = { userId: string; email: string; platformRole: PlatformRole | null; partnerSeats: PartnerSeat[] };

export type Membership = {
  orgId: string;
  orgName: string;
  role: Role;
  status: AccountStatus;
  /** `partner`: the account is one of the caller's partner's clients, not their own. */
  via: AccessVia;
  partnerName: string;
  sites: { id: string; slug: string; name: string; url: string }[];
};

/** GET /api/me — everything the console needs to route and render. */
export type Me = {
  identity: Identity | null;
  profile: { mobileMasked: string | null; mobileVerified: boolean } | null;
  memberships: Membership[];
  /** "demo" when the API runs without a database (local, no keys). */
  mode: "demo" | "live";
  stage: "development" | "preview" | "production";
};

// ── Risk and the Bridge ─────────────────────
/** What a change can touch; money, data, auth and security always need the Owner (gates.ts). */
export type RiskClass = "display" | "content" | "code" | "money" | "data" | "auth" | "security";

/** The site record the Control Room layout reads (Gen 1 gauges and request lists retired, traceability T7). */
export type Bridge = { site: Site };

// ── Health (Lighthouse + architecture vital signs) ────────────────────────
export type LighthouseScores = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  ranAt: string;
  source: "pagespeed" | "sample";
  page: string;
};

/** Critically ill → stabilizing → recovering → healthy. */
export type Triage = "critical" | "stabilizing" | "recovering" | "healthy";

export type VitalSign = {
  id: string;
  name: string;
  score: number;
  reading: string;
  explains: string;
  trend: number[];
};

export type Health = {
  lighthouse: LighthouseScores[];
  triage: Triage;
  triageNote: string;
  vitals: VitalSign[];
  hotspots: { path: string; why: string; changes90d: number }[];
  treatmentPlan: { phase: string; goal: string; status: "done" | "active" | "next" }[];
};

// ── Configuration (the env manifest) ──────────────────────────────────────
export type Environment = "development" | "preview" | "production";

export type EnvStatus = "set" | "missing" | "not-needed" | "stale";

/** One key the site needs. Values are never stored here — only whether each environment has one. */
export type EnvVarSpec = {
  key: string;
  service: string;
  purpose: string;
  secret: boolean;
  requiredBy: string[];
  environments: Record<Environment, EnvStatus>;
  lastVerified: string | null;
  howToGet: string;
};

export type Connection = {
  id: string;
  name: string;
  status: "connected" | "warning" | "missing";
  detail: string;
  lastTested: string;
};

export type Configuration = {
  env: EnvVarSpec[];
  connections: Connection[];
  rolePermissions: { role: string; code: string; testData: string; liveData: string; goLive: string; money: string }[];
  members: Member[];
};

// ── Account (subscription, payment, meters) ───────────────────────────────
export type PlanId = "commission" | "operate" | "managed";

export type UsageMeter = {
  provider: string;
  model: string;
  role: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  limitUsd: number;
};

export type Account = {
  org: Org;
  plan: { id: PlanId; name: string; monthlyUsd: number; installFeeUsd: number; installPaid: boolean; renewsOn: string };
  card: { brand: string; last4: string; expires: string } | null;
  invoices: { id: string; date: string; description: string; amountUsd: number; status: "paid" | "due" }[];
  meters: UsageMeter[];
  dailyCapUsd: number;
  monthToDateUsd: number;
};

// ── Code (Engineer view) ──────────────────────────────────────────────────
export type FileNode = { name: string; path: string; type: "dir" | "file"; children?: FileNode[] };

// ── Platform Admin ────────────────────────────────────────────────────────
export type AdminAccountRow = {
  id: string;
  name: string;
  status: AccountStatus;
  plan: PlanId;
  billingMode: BillingMode;
  installFeeQuoteUsd: number | null;
  mrrUsd: number;
  members: number;
  sites: number;
  aiSpendMonthUsd: number;
  openRequests: number;
  createdAt: string;
  lastActivityAt: string | null;
};

export type AdminOverview = {
  accounts: Record<AccountStatus, number> & { total: number };
  people: { members: number; platformStaff: number; openInvites: number };
  work: { openRequests: number; changesInFlight: number };
  aiSpendMonthUsd: number;
  textsLast24h: { sent: number; suppressed: number; failed: number };
  /** Present only for roles holding revenue.view. */
  revenue?: { mrrUsd: number; arrUsd: number; installFeesQuotedUsd: number; grossMarginMonthUsd: number };
};

export type AuditEntry = { id: number; at: string; actorEmail: string | null; action: string; orgId: string | null; orgName: string | null; detail: Record<string, unknown> };

export type AdminAccountDetail = AdminAccountRow & {
  suspendedAt: string | null;
  suspendedReason: string | null;
  people: { id: string; name: string; email: string | null; role: Role }[];
  invites: { id: string; email: string; role: Role; createdAt: string }[];
  siteList: { id: string; slug: string; name: string; url: string }[];
  audit: AuditEntry[];
};

export type PlatformStaff = { userId: string; email: string; role: PlatformRole; addedAt: string };

export type NewAccountInput = {
  name: string;
  siteName: string;
  siteUrl: string;
  plan: PlanId;
  billingMode: BillingMode;
  installFeeQuoteUsd?: number;
  ownerEmail: string;
};
