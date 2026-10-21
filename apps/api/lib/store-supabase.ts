import {
  resolveSiteAccess,
  type Account,
  type AccountStatus,
  type EnvVarSpec,
  type Role,
  type Site,
  type UsageMeter,
} from "@accelerator/domain";

import * as F from "./fixtures";
import { repoFile, repoTree } from "./github";
import type { AcceleratorStore } from "./store-types";
import { memberships } from "./identity";
import { hasSupportGrant } from "./partners";
import { db } from "./supabase";

/**
 * The multi-tenant database store (supabase/migrations 0001 + 0002).
 *
 * Every query is scoped by org_id or site_id explicitly: the service-role
 * client bypasses RLS, so tenant isolation here is this file's job.
 *
 * Still served from the demo sample for the demo tenant only: architecture
 * vital signs, connections and plan/card/invoices (Stripe comes later).
 */

const TZ = "America/New_York";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
function ago(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return day(iso);
}

async function must<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as T;
}

type Row = Record<string, unknown> & { id: string };

/** PostgREST returns an embedded to-one relation as an object (typed as an array). */
/**
 * Sample data (fixtures.ts) belongs only to demo sites (acc_sites.demo, the
 * seeded Cypress tenant). Every real site shows its own data or nothing.
 */
const demoCache = new Map<string, { demo: boolean; until: number }>();
async function isDemo(siteId: string): Promise<boolean> {
  const hit = demoCache.get(siteId);
  if (hit && hit.until > Date.now()) return hit.demo;
  const { data } = await db().from("acc_sites").select("demo").eq("id", siteId).maybeSingle();
  const demo = !!data?.demo;
  demoCache.set(siteId, { demo, until: Date.now() + 60_000 });
  return demo;
}

async function repoSite(siteId: string) {
  const { data } = await db().from("acc_sites").select("id, repo, base_branch").eq("id", siteId).single();
  return { id: siteId, repo: (data?.repo as string) ?? "", baseBranch: (data?.base_branch as string) ?? undefined };
}

function toSite(r: Row): Site {
  return {
    id: r.id,
    orgId: r.org_id as string,
    slug: r.slug as string,
    name: r.name as string,
    url: r.url as string,
    repo: r.repo as string,
    stack: (r.stack as string) ?? "",
    status: r.status as Site["status"],
    lastReleaseAt: r.created_at as string,
    demo: !!r.demo,
  };
}

export function createSupabaseStore(): AcceleratorStore {
  async function account(orgId: string) {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const [org, usage, limits] = await Promise.all([
      must<Row>(db().from("acc_orgs").select("*").eq("id", orgId).single()),
      must<Row[]>(db().from("acc_usage").select("*").eq("org_id", orgId).gte("at", monthStart)),
      must<Row[]>(db().from("acc_limits").select("*").eq("org_id", orgId)),
    ]);
    const meters = new Map<string, UsageMeter>();
    for (const u of usage) {
      const key = u.model as string;
      const m = meters.get(key) ?? { provider: u.provider as string, model: key, role: u.role as string, tokensIn: 0, tokensOut: 0, costUsd: 0, limitUsd: 0 };
      m.tokensIn += Number(u.tokens_in);
      m.tokensOut += Number(u.tokens_out);
      m.costUsd += Number(u.cost_usd);
      meters.set(key, m);
    }
    for (const l of limits.filter((l) => l.period === "month")) {
      const m = meters.get(l.model as string);
      if (m) m.limitUsd = Number(l.limit_usd);
    }
    const list = [...meters.values()].map((m) => ({ ...m, costUsd: Math.round(m.costUsd * 100) / 100 }));
    const daily = limits.find((l) => l.model === "*" && l.period === "day");
    const demo = ((await db().from("acc_sites").select("id").eq("org_id", orgId).eq("demo", true).limit(1)).data ?? []).length > 0;
    const PLAN_NAME = { commission: "Commission", operate: "Operate", managed: "Managed" } as const;
    const base: Omit<Account, "org" | "meters" | "dailyCapUsd" | "monthToDateUsd"> = demo
      ? F.ACCOUNT
      : {
          plan: {
            id: org.plan as Account["plan"]["id"],
            name: PLAN_NAME[org.plan as keyof typeof PLAN_NAME] ?? String(org.plan),
            monthlyUsd: 0,
            installFeeUsd: Number(org.install_fee_quote_usd ?? 0),
            installPaid: false,
            renewsOn: "Not billed yet",
          },
          card: null,
          invoices: [],
        };
    return {
      ...base, // card and invoices come from Stripe later
      org: { id: org.id, name: org.name as string, plan: org.plan as typeof F.ACCOUNT.org.plan },
      meters: list,
      dailyCapUsd: daily ? Number(daily.limit_usd) : F.ACCOUNT.dailyCapUsd,
      monthToDateUsd: Math.round(list.reduce((s, m) => s + m.costUsd, 0)),
    };
  }

  return {
    kind: "supabase",

    /**
     * Who may open this site, in the fixed order of tenancy.ts: the account's
     * own people, then its partner's team, then a live support grant. There is
     * no standing platform bypass (gen2-crew.md §5).
     */
    async access(identity, idOrSlug) {
      const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
      const rows = await must<Row[]>(db().from("acc_sites").select("*").eq(isUuid ? "id" : "slug", idOrSlug).limit(1));
      const site = rows[0];
      if (!site) return undefined;
      const orgId = site.org_id as string;
      const [member, org] = await Promise.all([
        must<Row[]>(db().from("acc_members").select("*").eq("org_id", orgId).eq("user_id", identity.userId).limit(1)),
        must<Row>(db().from("acc_orgs").select("status, partner_id, acc_partners(name)").eq("id", orgId).single()),
      ]);
      const m = member[0];
      const partnerId = org.partner_id as string;
      const partner = (Array.isArray(org.acc_partners) ? org.acc_partners[0] : org.acc_partners) as { name: string } | null;
      const partnerName = partner?.name ?? "Partner";
      const partnerRole = identity.partnerSeats.find((p) => p.partnerId === partnerId)?.role ?? null;
      // Only look for a support grant when nothing else applies.
      const supportGrant = !m && !partnerRole && !!identity.platformRole && (await hasSupportGrant(identity.userId, orgId, partnerId));

      const access = resolveSiteAccess({ memberRole: (m?.role as Role | undefined) ?? null, partnerRole, supportGrant });
      if (!access) return undefined;
      const caller =
        access.via === "member"
          ? { memberId: m!.id as string, orgId, role: access.role, name: m!.name as string, via: access.via, partnerName }
          : { memberId: access.via, orgId, role: access.role, name: `${identity.email} (${partnerName})`, via: access.via, partnerName };
      return { site: toSite(site), caller, status: org.status as AccountStatus };
    },
    memberships: (identity) => memberships(identity),

    async bridge(site) {
      return { site };
    },

    async health(siteId) {
      const snaps = await must<Row[]>(
        db().from("acc_health_snapshots").select("*").eq("site_id", siteId).eq("kind", "lighthouse").order("taken_at", { ascending: false }).limit(50),
      );
      const latest = new Map<string, typeof F.HEALTH.lighthouse[number]>();
      for (const s of snaps) {
        const d = s.data as typeof F.HEALTH.lighthouse[number];
        if (!latest.has(d.page)) latest.set(d.page, d);
      }
      if (await isDemo(siteId)) {
        // Demo: pages never audited live keep their sample until they are.
        return { ...F.HEALTH, lighthouse: [...latest.values(), ...F.HEALTH.lighthouse.filter((l) => !latest.has(l.page))] };
      }
      return {
        lighthouse: [...latest.values()],
        triage: "healthy",
        triageNote: "Not assessed yet. The engine assesses code health after checkout.",
        vitals: [],
        hotspots: [],
        treatmentPlan: [],
      };
    },
    async recordLighthouse(site, scores) {
      await must(db().from("acc_health_snapshots").insert({ org_id: site.orgId, site_id: site.id, kind: "lighthouse", data: scores }).select("id"));
      return scores;
    },

    async configuration(siteId) {
      const site = await must<Row>(db().from("acc_sites").select("id, org_id").eq("id", siteId).single());
      const [rows, members] = await Promise.all([
        must<Row[]>(db().from("acc_env_specs").select("*").eq("site_id", siteId).order("service").order("key")),
        must<Row[]>(db().from("acc_members").select("*").eq("org_id", site.org_id as string).order("created_at")),
      ]);
      const env: EnvVarSpec[] = rows.map((r) => ({
        key: r.key as string,
        service: r.service as string,
        purpose: r.purpose as string,
        secret: r.secret as boolean,
        requiredBy: (r.required_by as string[]) ?? [],
        environments: r.status as EnvVarSpec["environments"],
        lastVerified: ago(r.last_verified as string | null),
        howToGet: (r.how_to_get as string) ?? "",
      }));
      return {
        ...F.CONFIGURATION,
        connections: (await isDemo(siteId)) ? F.CONFIGURATION.connections : [],
        env,
        members: members.map((m) => ({ id: m.id, name: m.name as string, email: "", role: m.role as Role })),
      };
    },

    account,
    async setLimits(orgId, input) {
      const upserts: Record<string, unknown>[] = [];
      if (typeof input.dailyCapUsd === "number") upserts.push({ org_id: orgId, model: "*", period: "day", limit_usd: input.dailyCapUsd });
      for (const l of input.limits ?? []) upserts.push({ org_id: orgId, model: l.model, period: "month", limit_usd: l.limitUsd });
      if (upserts.length) await must(db().from("acc_limits").upsert(upserts, { onConflict: "org_id,model,period" }).select("model"));
      return account(orgId);
    },

    async codeTree(siteId) {
      if (await isDemo(siteId)) return F.FILE_TREE;
      return repoTree(await repoSite(siteId));
    },
    async codeFile(siteId, path) {
      if (await isDemo(siteId)) return F.FILE_CONTENTS[path] ?? `// ${path}\n// File contents stream from the site's repository once GitHub is connected.\n`;
      return repoFile(await repoSite(siteId), path);
    },
  };
}
