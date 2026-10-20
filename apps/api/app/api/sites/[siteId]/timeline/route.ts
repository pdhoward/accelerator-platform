import { readTimelineFilter } from "@accelerator/domain";

import { json, workRoute } from "@/lib/http";
import { timeline } from "@/lib/library";

/** The Site Timeline (gen2-crew.md §18, G2.5): the Change Ledger, newest first, a page at a time. */
export const GET = workRoute(async ({ request, site }) => {
  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before")) || null;
  const work = url.searchParams.get("work");
  return json(await timeline(site, { before, filter: readTimelineFilter(url.searchParams.get("filter")), work: work ? Number(work) : null }));
});
