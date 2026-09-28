import { json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

/** The env manifest: which keys the site needs and whether each environment has them. Never values. */
export const GET = siteRoute(async ({ site }) => json(await store.configuration(site.id)));
