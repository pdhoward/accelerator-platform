import { z } from "zod";

import { fail, json, siteRoute } from "@/lib/http";
import { runLighthouse } from "@/lib/lighthouse";
import { store } from "@/lib/store";

export const maxDuration = 60;

const schema = z.object({ page: z.string().startsWith("/").max(300).default("/") });

/** Runs a real Lighthouse audit on one page of the site and records it. */
export const POST = siteRoute(async ({ request, site }) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("Page must be a path like /villas.", 400);
  const url = new URL(parsed.data.page, site.url).toString();
  const scores = await runLighthouse(url, parsed.data.page);
  if (!scores) return fail("Lighthouse is busy or over quota right now. Try again in a minute.", 503);
  return json(await store.recordLighthouse(site, scores));
});
