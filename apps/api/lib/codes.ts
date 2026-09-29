import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { isReserveCode, sha256 } from "./env";
import { maskPhone } from "./phone";
import { sendSms } from "./sms";
import { db } from "./supabase";

/**
 * Texted one-time codes, generated and checked here (Twilio only delivers).
 * Only a salted hash is stored; codes expire in 10 minutes, allow 5 tries,
 * and each number gets at most 5 texts an hour.
 */
export type CodePurpose = "sign_in" | "verify_mobile";

const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_PER_HOUR = 5;

export class CodeError extends Error {}

const hashCode = (id: string, code: string) => sha256(`${id}:${code}`);

export async function issueCode(input: { email: string; mobile: string; purpose: CodePurpose }): Promise<{ masked: string }> {
  const email = input.email.toLowerCase();
  const masked = maskPhone(input.mobile);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await db()
    .from("acc_sms_codes")
    .select("id", { count: "exact", head: true })
    .eq("mobile_e164", input.mobile)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_PER_HOUR) throw new CodeError("Too many codes requested. Try again in an hour, or use the email link.");

  // One live code per person and purpose: older ones stop working.
  await db()
    .from("acc_sms_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("email", email)
    .eq("purpose", input.purpose)
    .is("consumed_at", null);

  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db()
    .from("acc_sms_codes")
    .insert({
      id,
      email,
      mobile_e164: input.mobile,
      purpose: input.purpose,
      code_hash: hashCode(id, code),
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    });
  if (error) throw new Error(error.message);

  const log = { email, to_masked: masked, purpose: input.purpose };
  try {
    const result = await sendSms(input.mobile, `Your Accelerator code is ${code}. It expires in 10 minutes.`);
    await db().from("acc_sms_log").insert({ ...log, provider: result.provider, status: result.status, detail: result.detail ?? null });
  } catch (err) {
    await db().from("acc_sms_log").insert({ ...log, provider: "twilio", status: "failed", detail: (err as Error).message });
    throw new CodeError("We couldn't send the text. Try again, or use the email link.");
  }
  return { masked };
}

/** True when the code (or, outside production, the person's reserve code) is right. */
export async function checkCode(input: { email: string; purpose: CodePurpose; code: string }): Promise<boolean> {
  const code = input.code.replace(/\D/g, "");
  if (isReserveCode(input.email, input.code.trim())) return true;

  const { data } = await db()
    .from("acc_sms_codes")
    .select("id, code_hash, expires_at, attempts")
    .eq("email", input.email.toLowerCase())
    .eq("purpose", input.purpose)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_ATTEMPTS) return false;

  const ok = timingSafeEqual(Buffer.from(hashCode(row.id, code)), Buffer.from(row.code_hash));
  await db()
    .from("acc_sms_codes")
    .update(ok ? { consumed_at: new Date().toISOString() } : { attempts: row.attempts + 1 })
    .eq("id", row.id);
  return ok;
}
