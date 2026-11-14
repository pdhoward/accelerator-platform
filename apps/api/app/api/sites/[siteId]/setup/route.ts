import { z } from "zod";

import { DOMAINS, SITE_PATHS } from "@accelerator/domain";

import { body, fail, json, workRoute } from "@/lib/http";
import { latestCheckout, saveSiteSettings, siteSetup } from "@/lib/work";

/** Setup: Install · Checkout · Agreement (flywheel.md §3). */
export const GET = workRoute(async ({ site }) => json({ ...(await siteSetup(site)), checkout: await latestCheckout(site.id) }));

const schema = z.object({
  /** The account owner's: what the site is called, where it runs, what it is, and its industry (the pack). */
  name: z.string().trim().min(2).max(120).optional(),
  url: z.string().trim().max(300).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  repo: z.union([z.string().regex(/^(https:\/\/github\.com\/)?[\w.-]+\/[\w.-]+?(\.git)?$/, "Use owner/name, e.g. pdhoward/machineshop"), z.literal("")]).nullable().optional(),
  repoPath: z.string().max(400).nullable().optional(),
  baseBranch: z.string().trim().min(1).max(80).optional(),
  stageUrl: z.union([z.url(), z.literal("")]).nullable().optional(),
  /** The industry pack the site runs on (gen2-crew.md §20, gen3-cradle.md §3). */
  domain: z.enum(DOMAINS).nullable().optional(),
  /** Modernize (Work items on the code) or Transform (the Cradle), B31. */
  path: z.enum(SITE_PATHS).optional(),
  /** Who the runner commits as (a GitHub account on the site's Vercel team); null clears it (migration 0022). */
  commitAuthor: z.object({ name: z.string().trim().min(1).max(80).regex(/^[^"`$\\\n\r]+$/, "No quotes or special characters"), email: z.email() }).nullable().optional(),
});

export const PATCH = workRoute(async ({ request, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Check the settings.", 400);
  await saveSiteSettings(site, input);
  return json({ ok: true });
}, "config.manage");
