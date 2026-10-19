import { timingSafeEqual } from "node:crypto";

import { runRetention } from "@/lib/retention";

/**
 * Nightly retention (gen2-crew.md §21.4). Called by Supabase (pg_cron + pg_net,
 * migration 0011), which sends `Authorization: Bearer <CRON_SECRET>` from
 * Supabase Vault; anything else is refused.
 */
export async function GET(request: Request) {
  const want = process.env.CRON_SECRET;
  if (!want) return Response.json({ error: "CRON_SECRET isn't set on the API." }, { status: 503 });
  const got = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return Response.json({ error: "Not allowed." }, { status: 401 });
  const report = await runRetention();
  return Response.json(report, { status: report.errors.length ? 207 : 200 });
}

export const maxDuration = 60;
