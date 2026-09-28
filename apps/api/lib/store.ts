import { createMemoryStore } from "./store-memory";
import { createSupabaseStore } from "./store-supabase";
import type { AcceleratorStore } from "./store-types";
import { supabaseConfig } from "./supabase";

export type { AcceleratorStore } from "./store-types";

/**
 * Supabase when its URL and service key are present (the startup script injects
 * them from envmachine); otherwise the in-memory demo tenant, so `pnpm dev`
 * works with no keys at all.
 *
 * Only the memory store is cached on globalThis (so demo edits survive dev hot
 * reloads). The Supabase store is stateless and rebuilt with each module load,
 * so code changes and newly injected keys take effect without a stale instance.
 */
const g = globalThis as unknown as { __acceleratorMemoryStore?: AcceleratorStore };

export const store: AcceleratorStore = supabaseConfig()
  ? createSupabaseStore()
  : (g.__acceleratorMemoryStore ??= createMemoryStore());
