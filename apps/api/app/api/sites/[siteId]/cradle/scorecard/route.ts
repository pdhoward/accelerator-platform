import { json, siteRoute } from "@/lib/http";
import { scorecard } from "@/lib/proof";

/** The proof scorecard (B7): pass rates, flaky and failing cases with advice, coverage gaps, history and cost. */
export const GET = siteRoute(async ({ site }) => json(await scorecard(site)));
