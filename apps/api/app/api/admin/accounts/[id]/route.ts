import { z } from "zod";

import { accountDetail, updateAccount } from "@/lib/admin";
import { body, fail, json, platformRoute } from "@/lib/http";

export const GET = platformRoute<{ id: string }>("platform.view", async ({ params }) => {
  const detail = await accountDetail(params.id);
  return detail ? json(detail) : fail("Account not found.", 404);
});

const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    plan: z.enum(["commission", "operate", "managed"]),
    billingMode: z.enum(["stripe", "invoiced", "comped"]),
    installFeeQuoteUsd: z.number().min(0).max(1_000_000).nullable(),
    website: z.string().trim().max(300).nullable(),
  })
  .partial();

/** Edit the account's details: name, plan, billing, quote and the company's website. */
export const PATCH = platformRoute<{ id: string }>("accounts.manage", async ({ request, identity, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Check the account's details.", 400);
  await updateAccount(identity, params.id, input);
  return json({ ok: true });
});
