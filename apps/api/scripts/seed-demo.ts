/**
 * Seeds the demo tenant (Example Machine Shop, gen2-crew.md G2.4) into the
 * Supabase control-plane database: the company, members, the site (marked
 * demo), the key list, usage and limits. Safe to re-run: it deletes the demo
 * company first, and the earlier Cypress-themed one if it is still there
 * (everything else cascades), then inserts fresh rows. The full Work story
 * (three items, the ledger, capabilities, Boarding) is the keyless demo's.
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
  // 1. Clear the previous demo tenant, and the retired Cypress-themed one.
  for (const name of [F.ORG.name, "Thin Spaces Hotel Company"]) {
    await run("delete org", sb.from("acc_orgs").delete().eq("name", name).select("id"));
  }

  // 2. Org, members, site.
  // Account #1 is boarded free (comped) with the platform owner as its Owner,
  // as a direct client of the house partner (migration 0006).
  const house = await run<{ id: string }>("house partner", sb.from("acc_partners").select("id").eq("kind", "house").single());
  const org = await run<{ id: string }>(
    "org",
    sb.from("acc_orgs").insert({ name: F.ORG.name, plan: F.ORG.plan, status: "active", billing_mode: "comped", partner_id: house.id }).select("id").single(),
  );
  const members = await run<{ id: string; name: string }[]>(
    "members",
    sb
      .from("acc_members")
      .insert(F.MEMBERS.map((m) => ({ org_id: org.id, user_id: randomUUID(), name: m.name, email: m.email, role: m.role })))
      .select("id, name"),
  );
  const s = F.SITES[0]!;
  const site = await run<{ id: string }>(
    "site",
    sb.from("acc_sites").insert({ org_id: org.id, slug: s.slug, name: s.name, url: s.url, repo: s.repo, stack: s.stack, status: s.status, demo: true, domain: "commerce" }).select("id").single(),
  );
  const base = { org_id: org.id, site_id: site.id };

  // Invite the platform owner(s) in as account Owner: the first sign-in accepts it.
  const owners = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (owners.length) {
    await run("owner invites", sb.from("acc_invites").insert(owners.map((email) => ({ org_id: org.id, email, role: "owner" }))).select("id"));
  }

  // 3. Configuration: the env manifest (names and status only — never values).
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

  // 4. Usage this month and limits.
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

  console.log(`Seeded "${F.ORG.name}" (${org.id}) with site ${s.slug} (${site.id}); owner invite: ${owners.join(", ") || "none (set PLATFORM_ADMIN_EMAILS)"}.`);
  console.log(`  ${members.length} members · ${F.CONFIGURATION.env.length} env keys · ${F.ACCOUNT.meters.length} usage meters`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
