import { siteRoute } from "../../../../../lib/http";
import { readBriefing } from "../../../../../lib/studio";
/** Authenticated read-only projection; tenant resolved by the existing access boundary. */
export const GET = siteRoute(async ({ site }) =>
  Response.json(await readBriefing(site), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
