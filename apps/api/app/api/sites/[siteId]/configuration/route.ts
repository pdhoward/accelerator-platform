import { json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

export const GET = siteRoute(async ({ site }) => json(await store.configuration(site.id)));
