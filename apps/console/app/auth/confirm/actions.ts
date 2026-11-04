"use server";

import { redirect } from "next/navigation";

import { serverSupabase } from "@/lib/supabase";

/**
 * Exchange the emailed one-time token for a session. Only a person pressing
 * Continue gets here (a form post): mail scanners that open every link, like
 * Microsoft Safe Links on Outlook and Hotmail, never use the token up.
 */
export async function confirmSignIn(f: FormData) {
  const tokenHash = String(f.get("token_hash") ?? "");
  const next = String(f.get("next") ?? "");
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (tokenHash) {
    const { error } = await (await serverSupabase()).auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!error) redirect(target);
  }
  redirect("/login?error=That+link+has+expired+or+was+already+used.+Request+a+new+one.");
}
