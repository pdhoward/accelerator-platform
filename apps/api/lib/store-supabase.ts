import {
  canApprove,
  type AccountStatus,
  canShip,
  type Change,
  type Consultation,
  type Doc,
  type EnvVarSpec,
  type Release,
  type Role,
  type Site,
  type SiteRequest,
  type Skill,
  type UsageMeter,
} from "@accelerator/domain";

import * as F from "./fixtures";
import type { AcceleratorStore } from "./store-types";
import { memberships } from "./identity";
import { db } from "./supabase";
import { requestTitle, triage } from "./triage";

/**
 * The multi-tenant database store (supabase/migrations 0001 + 0002).
 *
 * Every query is scoped by org_id or site_id explicitly: the service-role
 * client bypasses RLS, so tenant isolation here is this file's job.
 *
 * Not in the database yet (still served from fixtures, clearly v0): the Bridge
 * gauges, Needs you and Signals (they will be computed by monitors), the Data
 * Desk, Proof suites, architecture vital signs, connections, plan/card/
 * invoices (Stripe) and the code tree (GitHub).
 */

const TZ = "America/New_York";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", " ·");
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
function memberName(v: unknown): string {
  const m = Array.isArray(v) ? v[0] : v;
  return (m as { name?: string } | null)?.name ?? "Someone";
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
  };
}

function toRequest(r: Row, changeIdByRequest: Map<string, string>): SiteRequest {
  return {
    id: r.id,
    number: r.number as number,
    siteId: r.site_id as string,
    title: r.title as string,
    detail: (r.detail as string) ?? "",
    type: r.type as SiteRequest["type"],
    risk: (r.risk as SiteRequest["risk"]) ?? [],
    priority: r.priority as SiteRequest["priority"],
    stage: r.stage as SiteRequest["stage"],
    source: (r.source as string) ?? "",
    createdAt: r.created_at as string,
    changeId: changeIdByRequest.get(r.id),
    note: (r.note as string) ?? undefined,
  };
}

function toDoc(r: Row): Doc {
  // Body is Markdown ("## Heading\n\ntext" sections) — the same shape as the repo file.
  const sections = String(r.body ?? "")
    .split(/^## /m)
    .filter((s) => s.trim())
    .map((s) => {
      const [heading, ...rest] = s.split("\n");
      return { heading: (heading ?? "").trim(), body: rest.join("\n").trim() };
    });
  return {
    id: r.id,
    kind: r.kind as Doc["kind"],
    title: r.title as string,
    status: r.status as Doc["status"],
    updatedAt: ago(r.updated_at as string) ?? "",
    source: (r.source as string) ?? (r.repo_path as string) ?? "",
    sections,
  };
}

function toSkill(r: Row): Skill {
  return {
    id: r.id,
    name: r.name as string,
    category: r.category as Skill["category"],
    description: r.description as string,
    source: r.source as Skill["source"],
    version: r.version as string,
    enabled: r.enabled as boolean,
    usedBy: (r.used_by as string[]) ?? [],
  };
}

export function createSupabaseStore(): AcceleratorStore {
  async function changeRows(siteId: string, id?: string) {
    let q = db().from("acc_changes").select("*").eq("site_id", siteId).order("created_at", { ascending: false });
    if (id) q = q.eq("id", id);
    return must<Row[]>(q);
  }

  async function toChanges(rows: Row[]): Promise<Change[]> {
    if (rows.length === 0) return [];
    const approvals = await must<Record<string, unknown>[]>(
      db().from("acc_approvals").select("change_id, role, created_at, acc_members(name)").in("change_id", rows.map((r) => r.id)),
    );
    return rows.map((r) => {
      const d = (r.details ?? {}) as Partial<Change>;
      return {
        id: r.id,
        siteId: r.site_id as string,
        requestNumber: (r.request_number as number) ?? 0,
        title: r.title as string,
        stage: r.stage as Change["stage"],
        risk: (r.risk as Change["risk"]) ?? [],
        level: r.level as Change["level"],
        summary: (r.summary as string) ?? "",
        conversation: (r.conversation as Change["conversation"]) ?? [],
        before: d.before ?? { title: "", meta: "", lines: [], total: "" },
        after: d.after ?? { title: "", meta: "", lines: [], total: "" },
        alsoChanges: d.alsoChanges ?? [],
        unchanged: d.unchanged ?? [],
        designDoc: d.designDoc,
        evidence: (r.evidence as Change["evidence"]) ?? [],
        checklist: (r.checklist as Change["checklist"]) ?? [],
        approvals: approvals
          .filter((a) => a.change_id === r.id)
          .map((a) => ({
            by: memberName(a.acc_members),
            role: a.role as Role,
            at: a.created_at as string,
          })),
        engineer: (r.engineer as Change["engineer"]) ?? { pr: "", branch: "", files: [], stats: "", preview: "", models: "" },
      };
    });
  }

  async function requestsFor(siteId: string) {
    const [rows, changes] = await Promise.all([
      must<Row[]>(db().from("acc_requests").select("*").eq("site_id", siteId).order("number", { ascending: false })),
      must<{ id: string; request_id: string | null }[]>(db().from("acc_changes").select("id, request_id").eq("site_id", siteId)),
    ]);
    const byRequest = new Map(changes.filter((c) => c.request_id).map((c) => [c.request_id as string, c.id]));
    return rows.map((r) => toRequest(r, byRequest));
  }

  async function releasesFor(siteId: string): Promise<Release[]> {
    const rows = await must<Row[]>(db().from("acc_releases").select("*").eq("site_id", siteId).order("released_at", { ascending: false }));
    return rows.map((r) => ({
      id: r.id,
      at: when(r.released_at as string),
      title: r.title as string,
      detail: (r.notes as string) ?? "",
      requestNumber: (r.request_number as number) ?? undefined,
    }));
  }

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
    return {
      ...F.ACCOUNT, // plan, card and invoices come from Stripe later
      org: { id: org.id, name: org.name as string, plan: org.plan as typeof F.ACCOUNT.org.plan },
      meters: list,
      dailyCapUsd: daily ? Number(daily.limit_usd) : F.ACCOUNT.dailyCapUsd,
      monthToDateUsd: Math.round(list.reduce((s, m) => s + m.costUsd, 0)),
    };
  }

  return {
    kind: "supabase",

    async access(identity, idOrSlug) {
      const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
      const rows = await must<Row[]>(db().from("acc_sites").select("*").eq(isUuid ? "id" : "slug", idOrSlug).limit(1));
      const site = rows[0];
      if (!site) return undefined;
      const [member, org] = await Promise.all([
        must<Row[]>(db().from("acc_members").select("*").eq("org_id", site.org_id as string).eq("user_id", identity.userId).limit(1)),
        must<Row>(db().from("acc_orgs").select("status").eq("id", site.org_id as string).single()),
      ]);
      const m = member[0];
      if (!m) return undefined;
      return {
        site: toSite(site),
        caller: { memberId: m.id, orgId: m.org_id as string, role: m.role as Role, name: m.name as string },
        status: org.status as AccountStatus,
      };
    },

    memberships: (identity) => memberships(identity.userId),

    async bridge(site) {
      const [requests, releases] = await Promise.all([requestsFor(site.id), releasesFor(site.id)]);
      const open = requests.filter((r) => r.stage !== "done" && r.stage !== "watch");
      return {
        site,
        gauges: { ...F.GAUGES, openRequests: open.length },
        needsYou: F.NEEDS_YOU,
        signals: F.SIGNALS,
        inFlight: requests.filter((r) => r.stage !== "new" && r.stage !== "done"),
        recentReleases: releases.slice(0, 3),
      };
    },

    requests: requestsFor,

    async createRequest(siteId, text, source, caller) {
      const site = await must<Row>(db().from("acc_sites").select("id, org_id").eq("id", siteId).single());
      // Permanent per-site numbers. unique(site_id, number) guards races; retry once on a clash.
      for (let attempt = 0; attempt < 2; attempt++) {
        const top = await must<{ number: number }[]>(
          db().from("acc_requests").select("number").eq("site_id", siteId).order("number", { ascending: false }).limit(1),
        );
        const { data, error } = await db()
          .from("acc_requests")
          .insert({
            org_id: site.org_id,
            site_id: siteId,
            number: (top[0]?.number ?? 0) + 1,
            title: requestTitle(text),
            detail: "The engine is reading this and will ask any questions here.",
            ...triage(text),
            priority: "now",
            stage: "clarify",
            source,
            created_by: caller.memberId,
          })
          .select("*")
          .single();
        if (!error && data) return toRequest(data as Row, new Map());
        if (error && !error.message.includes("duplicate")) throw new Error(error.message);
      }
      throw new Error("Couldn't number the request. Try again.");
    },

    async changes(siteId) {
      return toChanges(await changeRows(siteId));
    },
    async change(siteId, id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
      return (await toChanges(await changeRows(siteId, id)))[0];
    },

    async approveChange(siteId, id, checked, caller) {
      const change = await this.change(siteId, id);
      if (!change) return { ok: false, error: "Change not found.", status: 404 };
      if (!canApprove(caller.role, change.risk)) return { ok: false, error: "Your role can't approve this change. Ask the site Owner.", status: 403 };
      if (!change.checklist.every((s) => checked.includes(s.id))) return { ok: false, error: "Finish the checklist before approving.", status: 422 };

      await must(
        db().from("acc_approvals").insert({ org_id: caller.orgId, change_id: id, member_id: caller.memberId, role: caller.role, gate: "try", checked }).select("id"),
      );
      const approvals = [...change.approvals, { by: caller.name, role: caller.role, at: new Date().toISOString() }];
      const check = canShip({ risk: change.risk, level: change.level, evidence: change.evidence, tried: true, approvals });
      if (check.canShip) {
        const row = await must<Row>(db().from("acc_changes").update({ stage: "ship" }).eq("id", id).eq("site_id", siteId).select("request_id").single());
        if (row.request_id) await must(db().from("acc_requests").update({ stage: "ship" }).eq("id", row.request_id as string).select("id"));
      }
      return { ok: true, change: (await this.change(siteId, id))!, blockers: check.blockers };
    },

    async dataDesk() {
      return { investigations: F.INVESTIGATIONS, checks: F.DATA_CHECKS };
    },

    async library(siteId) {
      const rows = await must<Row[]>(db().from("acc_docs").select("*").eq("site_id", siteId).order("updated_at", { ascending: false }));
      const docs = rows.map(toDoc).sort((a, b) => (a.kind === "rulebook" ? -1 : b.kind === "rulebook" ? 1 : 0));
      return { docs, facts: F.FACTS, drift: F.DRIFT };
    },
    async doc(siteId, id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
      const rows = await must<Row[]>(db().from("acc_docs").select("*").eq("site_id", siteId).eq("id", id).limit(1));
      return rows[0] ? toDoc(rows[0]) : undefined;
    },

    async consultations(siteId) {
      const rows = await must<Row[]>(db().from("acc_consultations").select("*").eq("site_id", siteId).order("held_at", { ascending: false }));
      return rows.map(
        (r): Consultation => ({
          id: r.id,
          title: r.title as string,
          date: when(r.held_at as string),
          mode: r.mode as Consultation["mode"],
          participants: (r.participants as string[]) ?? [],
          stage: r.stage as Consultation["stage"],
          transcriptExcerpt: (r.transcript as Consultation["transcriptExcerpt"]) ?? [],
          requirements: (r.requirements as Consultation["requirements"]) ?? [],
          openQuestions: (r.open_questions as Consultation["openQuestions"]) ?? [],
          designDoc: (r.doc_id as string) ?? undefined,
        }),
      );
    },

    releases: releasesFor,

    async proof() {
      return F.PROOF;
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
      // Pages never audited live keep their nightly sample until they are.
      const merged = [...latest.values(), ...F.HEALTH.lighthouse.filter((l) => !latest.has(l.page))];
      return { ...F.HEALTH, lighthouse: merged };
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
        env,
        members: members.map((m) => ({ id: m.id, name: m.name as string, email: "", role: m.role as Role })),
      };
    },

    async skills(siteId) {
      const rows = await must<Row[]>(db().from("acc_skills").select("*").eq("site_id", siteId).order("category").order("name"));
      return rows.map(toSkill);
    },
    async toggleSkill(siteId, id, enabled) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
      const rows = await must<Row[]>(db().from("acc_skills").update({ enabled }).eq("site_id", siteId).eq("id", id).select("*"));
      return rows[0] ? toSkill(rows[0]) : undefined;
    },

    account,
    async setLimits(orgId, input) {
      const upserts: Record<string, unknown>[] = [];
      if (typeof input.dailyCapUsd === "number") upserts.push({ org_id: orgId, model: "*", period: "day", limit_usd: input.dailyCapUsd });
      for (const l of input.limits ?? []) upserts.push({ org_id: orgId, model: l.model, period: "month", limit_usd: l.limitUsd });
      if (upserts.length) await must(db().from("acc_limits").upsert(upserts, { onConflict: "org_id,model,period" }).select("model"));
      return account(orgId);
    },

    async codeTree() {
      return F.FILE_TREE;
    },
    async codeFile(_siteId, path) {
      return F.FILE_CONTENTS[path] ?? `// ${path}\n// File contents stream from the site's repository once GitHub is connected.\n`;
    },
  };
}
