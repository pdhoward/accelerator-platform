import { isProduction } from "./env";

/**
 * The one SMS seam. A single Twilio client, pointed at a base URL:
 *   production           → https://api.twilio.com (needs TWILIO_* keys; fails loudly without them)
 *   outside production   → TWILIO_API_BASE = the Twilio emulator
 *                          (`npx emulate start --service twilio --port 4013`)
 *                          — or, with no emulator (e.g. on Vercel), the text is suppressed
 *                          and the team signs in with reserve codes.
 * Same request either way, so what passes against the emulator is what runs live.
 */
export type SmsResult = { provider: "twilio" | "emulator" | "suppressed"; status: "sent" | "suppressed"; detail?: string };

// The emulator's seeded account (vercel-labs/emulate defaults).
const EMULATOR = { sid: "AC00000000000000000000000000000000", token: "twilio_test_auth_token", from: "+15551234567" };

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const base = process.env.TWILIO_API_BASE ?? (isProduction() ? "https://api.twilio.com" : null);
  if (!base) return { provider: "suppressed", status: "suppressed", detail: "No SMS emulator outside production" };

  const emulator = !base.includes("api.twilio.com");
  const sid = process.env.TWILIO_ACCOUNT_SID ?? (emulator ? EMULATOR.sid : undefined);
  const token = process.env.TWILIO_AUTH_TOKEN ?? (emulator ? EMULATOR.token : undefined);
  const from = process.env.TWILIO_FROM ?? (emulator ? EMULATOR.from : undefined);
  if (!sid || !token || !from) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).");

  const res = await fetch(`${base.replace(/\/$/, "")}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`SMS send failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return { provider: emulator ? "emulator" : "twilio", status: "sent" };
}
