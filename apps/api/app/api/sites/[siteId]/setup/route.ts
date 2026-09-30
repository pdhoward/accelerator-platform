import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { latestCheckout, saveSiteSettings, siteSetup } from "@/lib/work";

/** Setup: Install · Checkout · Agreement (flywheel.md §3). */
export const GET = workRoute(async ({ site }) => json({ ...(await siteSetup(site)), checkout: await latestCheckout(site.id) }));

const schema = z.object({
  repoPath: z.string().max(400).nullable().optional(),
  baseBranch: z.string().trim().min(1).max(80).optional(),
  stageUrl: z.union([z.url(), z.literal("")]).nullable().optional(),
});

export const PATCH = workRoute(async ({ request, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Check the settings.", 400);
  await saveSiteSettings(site, input);
  return json({ ok: true });
}, "config.manage");
