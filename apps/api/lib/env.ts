import { createHash } from "node:crypto";

/**
 * Deployment stage and access settings (work/accounts-auth-admin.md §7).
 * APP_STAGE is explicit: Vercel's "Production" label does not make us production.
 */
export type Stage = "development" | "preview" | "production";

export function stage(): Stage {
  const s = process.env.APP_STAGE;
  return s === "production" || s === "preview" ? s : "development";
}

export const isProduction = () => stage() === "production";

/**
 * Local vs deployed URLs. Vercel sets VERCEL=1 on every deployment, so one
 * env file can hold both: NAME_LOCAL on the laptop, NAME_DEPLOYED on Vercel.
 */
export const onVercel = () => !!process.env.VERCEL;

export function localOrDeployed(name: string, localDefault: string): string {
  if (!onVercel()) return process.env[`${name}_LOCAL`] ?? localDefault;
  const url = process.env[`${name}_DEPLOYED`];
  if (!url) throw new Error(`${name}_DEPLOYED is not set on this Vercel project.`);
  return url;
}

/** Where sign-in links send people: the Control Room. */
export const consoleUrl = () => localOrDeployed("CONSOLE_URL", "http://localhost:4000").replace(/\/$/, "");

const emails = (value?: string) =>
  (value ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const platformAdminEmails = () => emails(process.env.PLATFORM_ADMIN_EMAILS);
export const devAllowlist = () => emails(process.env.DEV_ALLOWLIST);
export const selfServeSignup = () => process.env.SELF_SERVE_SIGNUP === "on";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Per-person reserve codes (DEV_RESERVE_CODES = "email:sha256,…"). Only
 * outside production, and only for that person's own email.
 */
export function isReserveCode(email: string, code: string): boolean {
  if (isProduction()) return false;
  const want = (process.env.DEV_RESERVE_CODES ?? "")
    .split(",")
    .map((pair) => pair.trim().split(":"))
    .find(([e]) => e?.toLowerCase() === email.toLowerCase())?.[1];
  return !!want && sha256(code) === want.toLowerCase();
}
