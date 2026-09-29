import { z } from "zod";

import { createAccount, listAccounts } from "@/lib/admin";
import { body, fail, json, platformRoute } from "@/lib/http";

export const GET = platformRoute("platform.view", async () => json(await listAccounts()));

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  siteName: z.string().trim().min(2).max(120),
  siteUrl: z.string().trim().min(4).max(300),
  plan: z.enum(["commission", "operate", "managed"]),
  billingMode: z.enum(["stripe", "invoiced", "comped"]),
  installFeeQuoteUsd: z.number().min(0).max(1_000_000).optional(),
  ownerEmail: z.email(),
});

/** New account (owner-provisioned): org + first site + the owner's invite. */
export const POST = platformRoute("accounts.manage", async ({ request, identity }) => {
  const input = await body(request, schema);
  if (!input) return fail("Fill in the account name, site, plan, billing mode and the owner's email.", 400);
  return json(await createAccount(identity, input), 201);
});
