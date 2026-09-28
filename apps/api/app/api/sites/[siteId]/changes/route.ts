import { json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

/** Every change for the site, newest first (the Change Room index). */
export const GET = siteRoute(async ({ site }) => json(await store.changes(site.id)));
