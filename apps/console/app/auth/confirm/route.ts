import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase";

/**
 * The emailed sign-in link lands here with a one-time token from our API;
 * exchanging it sets the session cookie, then we route home.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const next = url.searchParams.get("next");
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (tokenHash) {
    const { error } = await (await serverSupabase()).auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(target, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=That+link+has+expired+or+was+already+used.+Request+a+new+one.", url.origin));
}
