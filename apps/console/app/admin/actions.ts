"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BillingMode, PlanId, Role } from "@accelerator/domain";
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
      siteName: text(f, "siteName"),
      siteUrl: text(f, "siteUrl"),
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

export async function inviteMember(_: FormState, f: FormData): Promise<FormState> {
  const id = text(f, "id");
  const email = text(f, "email");
  return run(`/admin/accounts/${id}`, `Invited ${email}.`, (api) => api.admin.invite(id, email, text(f, "role") as Role));
}
