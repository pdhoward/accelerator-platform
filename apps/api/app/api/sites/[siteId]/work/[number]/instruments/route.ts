import { siteRoute } from "../../../../../../../lib/http";
import { readInstruments } from "../../../../../../../lib/instruments";

/** The Cockpit Dial for one Work item (gen2-crew.md §19.5). Read-only; the tenant comes from the caller's access. */
export const GET = siteRoute<{ siteId: string; number: string }>(async ({ site, params }) =>
  Response.json(await readInstruments(site, Number(params.number)), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
