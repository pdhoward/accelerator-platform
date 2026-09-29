import { json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

/** The site's account: plan, billing and AI usage meters. */
export const GET = siteRoute(async ({ caller }) => json(await store.account(caller.orgId)));
