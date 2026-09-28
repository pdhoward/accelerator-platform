import type { Caller } from "@accelerator/domain";

import { store } from "./store";

/**
 * Resolves who is calling. The tenant (orgId) ALWAYS comes from the
 * credential, never from anything the client sends.
 *
 * v0: no auth provider is wired yet, so every request is the demo Operator of
 * the demo org. When Supabase Auth lands, verify the Bearer JWT here and read
 * org_id + role from its claims (the ts-platform pattern).
 */
export async function resolveCaller(_request: Request): Promise<Caller> {
  return store.demoCaller();
}
