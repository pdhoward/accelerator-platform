"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { errorMessage as message, publicApi, serverApi } from "@/lib/api";
import { serverSupabase } from "@/lib/supabase";

/**
 * Sign-in and first-sign-in actions. The API decides who may enter and
 * checks codes; Supabase Auth holds the session (cookies).
 */
export type ActionResult = { ok: boolean; message?: string; masked?: string };

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function sendMagicLink(email: string, next?: string): Promise<ActionResult> {
  try {
    if (!(await publicApi().auth.precheck(email)).allowed) {
      return { ok: false, message: "This Control Room is invite-only. Ask your administrator for an invite." };
    }
    const redirectTo = `${await origin()}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error } = await (await serverSupabase()).auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
    return error ? { ok: false, message: error.message } : { ok: true };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

export async function sendSignInCode(email: string): Promise<ActionResult> {
  try {
    return { ok: true, masked: (await publicApi().auth.smsStart(email)).masked };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Right code (or reserve code) → the API's one-time token → a Supabase session. */
export async function verifySignInCode(email: string, code: string): Promise<ActionResult> {
  try {
    const { tokenHash } = await publicApi().auth.smsVerify(email, code);
    const { error } = await (await serverSupabase()).auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    return error ? { ok: false, message: error.message } : { ok: true };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

export async function startMobile(mobile: string, consentText: string): Promise<ActionResult> {
  try {
    return { ok: true, masked: (await (await serverApi()).profile.startMobile(mobile, consentText)).masked };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

export async function verifyMobile(code: string): Promise<ActionResult> {
  try {
    await (await serverApi()).profile.verifyMobile(code);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

export async function signOut() {
  await (await serverSupabase()).auth.signOut();
  redirect("/login");
}
