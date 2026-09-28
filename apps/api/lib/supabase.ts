import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The API's only database client. Service role: it bypasses RLS, so it lives
 * in apps/api alone, and every query here must scope by org_id / site_id
 * explicitly. (The ts-platform `db()` rule.)
 *
 * Reads the key names used in envmachine: NEXT_PUBLIC_SUPABASE_URL (or
 * SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 */
export function supabaseConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase is not configured.");
  client ??= createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
