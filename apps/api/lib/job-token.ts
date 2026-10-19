import { createHmac, timingSafeEqual } from "node:crypto";
import type { JobTokenClaims } from "@accelerator/domain";

/**
 * Job tokens (gen2-crew.md §1.2 change 1): minted per job at claim, bound to
 * the job, its tenant, its role, its claim generation and an expiry, and
 * verified by the Toolbelt on every call. HMAC-signed with TOOLBELT_SECRET
 * (falling back to RUNNER_TOKEN). The tenant comes from the token, never input.
 */

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

function secret(): string {
  const s = process.env.TOOLBELT_SECRET || process.env.RUNNER_TOKEN;
  if (!s) throw new Error("TOOLBELT_SECRET (or RUNNER_TOKEN) isn't set on the API.");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function signJobToken(claims: JobTokenClaims): string {
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

/** The claims of a valid, unexpired token, or null. */
export function verifyJobToken(token: string, now = Date.now()): JobTokenClaims | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JobTokenClaims;
    if (typeof c.exp !== "number" || c.exp < now || !c.jobId || !c.siteId || !c.orgId || !c.role) return null;
    return c;
  } catch {
    return null;
  }
}
