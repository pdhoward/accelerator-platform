/**
 * Seeds the demo tenant (Cypress Resort, Customer Zero) into the Supabase
 * control-plane database. Safe to re-run: it deletes the demo org first
 * (everything else cascades), then inserts fresh rows.
 *
 * Run with keys injected, from apps/api:
 *   pnpm exec dotenv -e <envmachine>/.env.development.local -- pnpm seed:demo
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import * as F from "../lib/fixtures";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing Supabase URL or service key. Inject the envmachine file with dotenv.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function run<T>(label: string, q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
}

/** "Sep 26 · 14:02" / "Sep 27 · 14:00" → a 2026 timestamp. */
const stamp = (label: string) => new Date(`${label.replace(" · ", " 2026 ")}`).toISOString();

/** "2 min ago" / "1 h ago" / "Today" / "Sep 20" → a timestamp near now. */
function verified(label: string | null): string | null {
  if (!label) return null;
  const now = Date.now();
  const m = label.match(/^(\d+) (min|h) ago$/);
  if (m) return new Date(now - Number(m[1]) * (m[2] === "min" ? 60_000 : 3_600_000)).toISOString();
  if (label === "Today") return new Date(now - 3 * 3_600_000).toISOString();
  return new Date(`${label} 2026 09:00`).toISOString();
}

async function main() {
  // 1. Clear the previous demo tenant.
  await run("delete org", sb.from("acc_orgs").delete().eq("name", F.ORG.name).select("id"));

  // 2. Org, members, site.
  const org = await run<{ id: string }>("org", sb.from("acc_orgs").insert({ name: F.ORG.name, plan: F.ORG.plan }).select("id").single());
  const members = await run<{ id: string; name: string }[]>(
    "members",
    sb
      .from("acc_members")
      .insert(F.MEMBERS.map((m) => ({ org_id: org.id, user_id: randomUUID(), name: m.name, role: m.role })))
      .select("id, name"),
  );
  const memberId = (name: string) => members.find((m) => m.name === name)?.id ?? null;
  const s = F.SITES[0]!;
  const site = await run<{ id: string }>(
    "site",
    sb.from("acc_sites").insert({ org_id: org.id, slug: s.slug, name: s.name, url: s.url, repo: s.repo, stack: s.stack, status: s.status }).select("id").single(),
  );
  const base = { org_id: org.id, site_id: site.id };

  // 3. Requests (permanent numbers kept).
  const reqs = await run<{ id: string; number: number }[]>(
    "requests",
    sb
      .from("acc_requests")
      .insert(
        F.REQUESTS.map((r) => ({
          ...base,
          number: r.number,
          title: r.title,
          detail: r.detail,
          type: r.type,
          risk: r.risk,
          priority: r.priority,
          stage: r.stage,
          source: r.source,
          note: r.note ?? null,
          created_by: memberId(r.source),
        })),
      )
      .select("id, number"),
  );
  const requestId = (n: number) => reqs.find((r) => r.number === n)?.id ?? null;

  // 4. Changes.
  await run(
    "changes",
    sb
      .from("acc_changes")
      .insert(
        F.CHANGES.map((c) => ({
          ...base,
          request_id: requestId(c.requestNumber),
          request_number: c.requestNumber,
          title: c.title,
          stage: c.stage,
          risk: c.risk,
          level: c.level,
          summary: c.summary,
          conversation: c.conversation,
          evidence: c.evidence,
          checklist: c.checklist,
          engineer: c.engineer,
          details: { before: c.before, after: c.after, alsoChanges: c.alsoChanges, unchanged: c.unchanged, designDoc: c.designDoc },
        })),
      )
      .select("id"),
  );

  // 5. Releases.
  await run(
    "releases",
    sb
      .from("acc_releases")
      .insert(F.RELEASES.map((r) => ({ ...base, title: r.title, notes: r.detail, request_number: r.requestNumber ?? null, released_at: stamp(r.at) })))
      .select("id"),
  );

  // 6. Library documents (body as Markdown sections).
  const docs = await run<{ id: string; title: string }[]>(
    "docs",
    sb
      .from("acc_docs")
      .insert(
        F.DOCS.map((d) => ({
          ...base,
          kind: d.kind,
          title: d.title,
          status: d.status,
          source: d.source,
          repo_path: d.source.includes("/") ? d.source : null,
          body: d.sections.map((x) => `## ${x.heading}\n\n${x.body}`).join("\n\n"),
        })),
      )
      .select("id, title"),
  );
  const docId = (fixtureId?: string) => {
    const title = F.DOCS.find((d) => d.id === fixtureId)?.title;
    return docs.find((d) => d.title === title)?.id ?? null;
  };

  // 7. Consultations.
  await run(
    "consultations",
    sb
      .from("acc_consultations")
      .insert(
        F.CONSULTATIONS.map((c) => ({
          ...base,
          title: c.title,
          mode: c.mode,
          stage: c.stage,
          participants: c.participants,
          transcript: c.transcriptExcerpt,
          requirements: c.requirements,
          open_questions: c.openQuestions,
          doc_id: docId(c.designDoc),
          held_at: stamp(c.date),
        })),
      )
      .select("id"),
  );

  // 8. Configuration: the env manifest (names and status only — never values).
  await run(
    "env specs",
    sb
      .from("acc_env_specs")
      .insert(
        F.CONFIGURATION.env.map((e) => ({
          ...base,
          key: e.key,
          service: e.service,
          purpose: e.purpose,
          secret: e.secret,
          required_by: e.requiredBy,
          status: e.environments,
          how_to_get: e.howToGet,
          last_verified: verified(e.lastVerified),
        })),
      )
      .select("id"),
  );

  // 9. Skills: library skills copied into the site, plus the site's own.
  await run(
    "skills",
    sb
      .from("acc_skills")
      .insert(
        F.SKILLS.map((k) => ({
          ...base,
          name: k.name,
          category: k.category,
          description: k.description,
          version: k.version,
          body: k.description,
          enabled: k.enabled,
          used_by: k.usedBy,
          source: k.source,
        })),
      )
      .select("id"),
  );

  // 10. Usage this month and limits.
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12).toISOString();
  await run(
    "usage",
    sb
      .from("acc_usage")
      .insert(
        F.ACCOUNT.meters.map((m) => ({
          ...base,
          provider: m.provider,
          model: m.model,
          role: m.role,
          tokens_in: m.tokensIn,
          tokens_out: m.tokensOut,
          cost_usd: m.costUsd,
          at: monthStart,
        })),
      )
      .select("id"),
  );
  await run(
    "limits",
    sb
      .from("acc_limits")
      .insert([
        ...F.ACCOUNT.meters.map((m) => ({ org_id: org.id, model: m.model, period: "month", limit_usd: m.limitUsd })),
        { org_id: org.id, model: "*", period: "day", limit_usd: F.ACCOUNT.dailyCapUsd },
      ])
      .select("model"),
  );

  console.log(`Seeded "${F.ORG.name}" (${org.id}) with site ${s.slug} (${site.id}).`);
  console.log(
    `  ${members.length} members · ${reqs.length} requests · ${F.CHANGES.length} change · ${F.RELEASES.length} releases · ${docs.length} docs · ` +
      `${F.CONSULTATIONS.length} consultations · ${F.CONFIGURATION.env.length} env keys · ${F.SKILLS.length} skills`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
