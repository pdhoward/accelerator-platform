import { z } from "zod";

import { SITE_PATHS } from "@accelerator/domain";

import { createAccount, listAccounts } from "@/lib/admin";
import { body, fail, json, platformRoute } from "@/lib/http";

export const GET = platformRoute("platform.view", async () => json(await listAccounts()));

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  website: z.string().trim().max(300).optional(),
  siteName: z.string().trim().min(2).max(120),
  siteDescription: z.string().trim().max(1000).optional(),
  siteUrl: z.string().trim().max(300).optional(),
  repo: z.string().trim().max(300).optional(),
  repoPath: z.string().trim().max(500).optional(),
  path: z.enum(SITE_PATHS).optional(),
  plan: z.enum(["commission", "operate", "managed"]),
  billingMode: z.enum(["stripe", "invoiced", "comped"]),
  installFeeQuoteUsd: z.number().min(0).max(1_000_000).optional(),
  ownerEmail: z.email(),
});

/** New account (owner-provisioned): org + first site (live address and/or code) + the owner's invite. */
export const POST = platformRoute("accounts.manage", async ({ request, identity }) => {
  const input = await body(request, schema);
  if (!input) return fail("Fill in the account name, site, plan, billing mode and the owner's email.", 400);
  return json(await createAccount(identity, input), 201);
});
