import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { SecretStatus, VaultEnv } from "@accelerator/domain";

import { CodeError } from "./codes";
import { db, rows } from "./supabase";

/**
 * The keys vault (flywheel.md I6). Values are encrypted here with
 * AES-256-GCM under VAULT_KEY (32 bytes, hex, API env only) and are never
 * returned to a browser: people see set/unset and the last 4 characters.
 *
 * Environments: development + preview (the site's test keys, handed to the
 * runner) and engine (keys the Accelerator uses for this site, e.g. a GitHub
 * token for a private repo). Production keys live only in Vercel.
 */
function key(): Buffer {
  const hex = process.env.VAULT_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new CodeError("The vault isn't set up yet (VAULT_KEY missing on the API).");
  return Buffer.from(hex, "hex");
}

export function seal(value: string, k: Buffer = key()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function open(sealed: { ciphertext: string; iv: string; tag: string }, k: Buffer = key()): string {
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export const last4 = (v: string) => (v.length <= 4 ? "••••" : `••••${v.slice(-4)}`);

export async function secretStatus(siteId: string): Promise<SecretStatus[]> {
  return (await rows(db().from("acc_secrets").select("environment, name, last4, updated_at").eq("site_id", siteId))).map((r) => ({
    environment: r.environment as VaultEnv,
    name: r.name as string,
    last4: r.last4 as string,
    updatedAt: r.updated_at as string,
  }));
}

export async function setSecret(site: { id: string; orgId: string }, userId: string, environment: VaultEnv, name: string, value: string) {
  const v = value.trim();
  if (!v) throw new CodeError("The value is empty.");
  const { error } = await db()
    .from("acc_secrets")
    .upsert(
      { org_id: site.orgId, site_id: site.id, environment, name, ...seal(v), last4: last4(v), updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "site_id,environment,name" },
    );
  if (error) throw new Error(error.message);
}

export async function removeSecret(siteId: string, environment: VaultEnv, name: string) {
  const { error } = await db().from("acc_secrets").delete().eq("site_id", siteId).eq("environment", environment).eq("name", name);
  if (error) throw new Error(error.message);
}

/** Server-side only: decrypted values for one environment (the runner, GitHub reads). */
export async function secretValues(siteId: string, environment: VaultEnv): Promise<Record<string, string>> {
  const list = await rows(db().from("acc_secrets").select("name, ciphertext, iv, tag").eq("site_id", siteId).eq("environment", environment));
  return Object.fromEntries(list.map((r) => [r.name as string, open(r as { ciphertext: string; iv: string; tag: string })]));
}
