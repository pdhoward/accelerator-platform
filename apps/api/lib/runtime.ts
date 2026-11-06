import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Site runtime tokens (backlog B4): how a running app reads its own policy
 * book. A token names one site and is signed by the API, so it can't be
 * forged or pointed at another site; it grants read access to that site's
 * book and nothing else. Rotating the secret revokes every token.
 */
const secret = () => process.env.CRADLE_RUNTIME_SECRET || process.env.TOOLBELT_SECRET || process.env.RUNNER_TOKEN || "";

const sign = (siteId: string, key: string) => createHmac("sha256", key).update(`cradle-runtime:${siteId}`).digest("base64url");

export function mintRuntimeToken(siteId: string): string {
  const key = secret();
  if (!key) throw new Error("CRADLE_RUNTIME_SECRET (or TOOLBELT_SECRET) isn't set on the API.");
  return `crt_${siteId}.${sign(siteId, key)}`;
}

/** The site a token names, or null when it isn't one the API signed. */
export function verifyRuntimeToken(token: string | null | undefined): string | null {
  const key = secret();
  const m = (token ?? "").match(/^crt_([0-9a-zA-Z-]{1,64})\.([A-Za-z0-9_-]{20,})$/);
  if (!key || !m) return null;
  const want = Buffer.from(sign(m[1]!, key));
  const got = Buffer.from(m[2]!);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1]! : null;
}
