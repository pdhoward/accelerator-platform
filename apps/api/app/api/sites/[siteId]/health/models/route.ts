import { json, siteRoute } from "@/lib/http";
import { siteModelHealth } from "@/lib/model-health";

/** GET — can the site's running app and its crew reach their AI model? (B18) */
export const GET = siteRoute(async ({ site }) => json(await siteModelHealth(site)));
