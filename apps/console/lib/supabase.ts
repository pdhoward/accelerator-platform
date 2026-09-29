import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase Auth in the console: sessions live in cookies (@supabase/ssr).
 * Without the two public keys the console runs the local demo, no sign-in.
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const authEnabled = !!(supabaseUrl && supabaseAnonKey);

/** For server components, server actions and route handlers. */
export async function serverSupabase() {
  const store = await cookies();
  return createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** The signed-in user's access token, forwarded to the API (which verifies it). */
export async function accessToken(): Promise<string | null> {
  if (!authEnabled) return null;
  const { data } = await (await serverSupabase()).auth.getSession();
  return data.session?.access_token ?? null;
}
