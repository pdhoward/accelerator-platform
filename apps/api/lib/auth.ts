import type { Identity } from "@accelerator/domain";

import { identityFromToken } from "./identity";
import { supabaseConfig } from "./supabase";

/** The local, no-keys demo: everyone is the demo Operator (store-memory.ts). */
export const DEMO_IDENTITY: Identity = { userId: "demo", email: "demo@local", platformRole: null };

export const demoMode = () => !supabaseConfig();

/**
 * Who is calling. Only a verified Supabase access token (Authorization: Bearer)
 * counts; accounts and roles are then read from the database, never from
 * anything the client sends.
 */
export async function resolveIdentity(request: Request): Promise<Identity | null> {
  if (demoMode()) return DEMO_IDENTITY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return token ? identityFromToken(token) : null;
}
