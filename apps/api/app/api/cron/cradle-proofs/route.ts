import { timingSafeEqual } from "node:crypto";

import { nudgeWaiting } from "@/lib/proof";

/**
 * The conformance gate's safety net (B5): every few minutes, any site whose
 * newest rules are not proven gets a nudge to prove them. Called by Supabase
 * (pg_cron + pg_net, migration 0017) with `Authorization: Bearer <CRON_SECRET>`
 * from Supabase Vault; anything else is refused.
 */
export async function GET(request: Request) {
  // The shared secret Supabase sends from its Vault (accelerator_cron_secret); some environments name it CHRON_SECRET.
  const want = process.env.CRON_SECRET || process.env.CHRON_SECRET;
  if (!want) return Response.json({ error: "CRON_SECRET isn't set on the API." }, { status: 503 });
  const got = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return Response.json({ error: "Not allowed." }, { status: 401 });
  return Response.json(await nudgeWaiting());
}

export const maxDuration = 60;
