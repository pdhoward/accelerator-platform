import { readTimelineFilter } from "@accelerator/domain";

import { demoMode } from "@/lib/auth";
import { fail, json, siteRoute } from "@/lib/http";
import { timeline } from "@/lib/library";
import { timelineSample } from "@/lib/studio-sample";

/** The Site Timeline (gen2-crew.md §18, G2.5): the Change Ledger, newest first, a page at a time. The keyless demo shows Machine Shop's sample. */
export const GET = siteRoute(async ({ request, site }) => {
  if (demoMode()) return site.demo ? json({ ...timelineSample(), sample: true }) : fail("This needs the database.", 503);
  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before")) || null;
  const work = url.searchParams.get("work");
  return json(await timeline(site, { before, filter: readTimelineFilter(url.searchParams.get("filter")), work: work ? Number(work) : null }));
});
