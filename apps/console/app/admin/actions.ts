"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BillingMode, PlanId, Role, SiteSource } from "@accelerator/domain";
import type { createApiClient } from "@accelerator/api-client";

import type { FormState } from "@/components/action-form";
import { errorMessage, serverApi } from "@/lib/api";

/**
 * Platform Admin writes. The API checks the platform role on every call;
 * these only turn form fields into API calls and refresh the page.
 */
type Api = ReturnType<typeof createApiClient>;

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function run(path: string, ok: string, fn: (api: Api) => Promise<unknown>): Promise<FormState> {
  try {
    await fn(await serverApi());
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  revalidatePath(path);
  return { ok: true, message: ok };
}

export async function createAccount(_: FormState, f: FormData): Promise<FormState> {
  let id: string;
  try {
    const fee = text(f, "installFeeQuoteUsd");
    ({ id } = await (await serverApi()).admin.createAccount({
      name: text(f, "name"),
      website: text(f, "website") || undefined,
      siteName: text(f, "siteName"),
      siteDescription: text(f, "siteDescription") || undefined,
      siteUrl: text(f, "siteUrl") || undefined,
      repo: text(f, "repo") || undefined,
      repoPath: text(f, "repoPath") || undefined,
      path: text(f, "path") === "transform" ? "transform" : "modernize",
      plan: text(f, "plan") as PlanId,
      billingMode: text(f, "billingMode") as BillingMode,
      installFeeQuoteUsd: fee ? Number(fee) : undefined,
      ownerEmail: text(f, "ownerEmail"),
    }));
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/accounts/${id}`);
}

export async function setAccountStatus(_: FormState, f: FormData): Promise<FormState> {
  const id = text(f, "id");
  const action = text(f, "action") as "suspend" | "resume";
  return run(`/admin/accounts/${id}`, action === "suspend" ? "Suspended." : "Resumed.", (api) =>
    api.admin.setStatus(id, action, text(f, "reason")),
  );
}

export async function updateMember(_: FormState, f: FormData): Promise<FormState> {
  const id = text(f, "id");
  return run(`/admin/accounts/${id}`, "Saved. A new email takes over this seat when it signs in.", (api) =>
    api.admin.updateMember(id, text(f, "memberId"), { name: text(f, "name"), email: text(f, "email"), role: text(f, "role") as Role }),
  );
}

export async function removeMember(_: FormState, f: FormData): Promise<FormState> {
  const id = text(f, "id");
  return run(`/admin/accounts/${id}`, "Removed.", (api) => api.admin.removeMember(id, text(f, "memberId")));
}

export async function inviteMember(_: FormState, f: FormData): Promise<FormState> {
  const id = text(f, "id");
  const email = text(f, "email");
  let sent: Awaited<ReturnType<Api["admin"]["invite"]>> | undefined;
  const state = await run(`/admin/accounts/${id}`, "", async (api) => (sent = await api.admin.invite(id, email, text(f, "role") as Role)));
  if (!state?.ok || !sent) return state;
  if (!sent.emailed) return { ok: false, message: `Invite saved, but the email couldn't be sent (${sent.note ?? "mail error"}). They can still sign in with ${email}.` };
  return { ok: true, message: sent.resent ? `Invite re-sent to ${email}.` : `Invited ${email}; the email is on its way.` };
}

export async function updateAccount(_: FormState, f: FormData): Promise<FormState> {
  const id = text(f, "id");
  const fee = text(f, "installFeeQuoteUsd");
  return run(`/admin/accounts/${id}`, "Account saved.", (api) =>
    api.admin.updateAccount(id, {
      name: text(f, "name"),
      website: text(f, "website") || null,
      plan: text(f, "plan") as PlanId,
      billingMode: text(f, "billingMode") as BillingMode,
      installFeeQuoteUsd: fee ? Number(fee) : null,
    }),
  );
}

/** The site's form carries its code sources as numbered rows (source_label_0, …); blank rows are dropped. */
export async function updateSite(_: FormState, f: FormData): Promise<FormState> {
  const id = text(f, "id");
  const sources: SiteSource[] = [];
  for (let i = 0; f.has(`source_label_${i}`); i++) {
    const row = { label: text(f, `source_label_${i}`), repo: text(f, `source_repo_${i}`) || null, path: text(f, `source_path_${i}`) || null, url: text(f, `source_url_${i}`) || null };
    if (row.label || row.repo || row.path || row.url) sources.push(row);
  }
  return run(`/admin/accounts/${id}`, "Site saved.", (api) =>
    api.admin.updateSite(id, text(f, "siteId"), {
      name: text(f, "name"),
      url: text(f, "url"),
      description: text(f, "description") || null,
      repo: text(f, "repo") || null,
      repoPath: text(f, "repoPath") || null,
      sources,
    }),
  );
}
