import { siteRoute } from "../../../../../lib/http";
import { readInstruments } from "../../../../../lib/instruments";

/** The Cockpit Dial for the whole site (gen2-crew.md §19.5). Read-only; the tenant comes from the caller's access. */
export const GET = siteRoute(async ({ site }) =>
  Response.json(await readInstruments(site), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
