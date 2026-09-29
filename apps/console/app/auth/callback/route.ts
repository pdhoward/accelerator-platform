import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase";

/** The magic link lands here: exchange the code for a session, then route home. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const { error } = await (await serverSupabase()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(target, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=That+link+has+expired+or+was+already+used.+Request+a+new+one.", url.origin));
}
