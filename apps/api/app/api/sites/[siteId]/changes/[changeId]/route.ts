import { fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

export const GET = siteRoute<{ siteId: string; changeId: string }>(async ({ site, params }) => {
  const change = await store.change(site.id, params.changeId);
  return change ? json(change) : fail("Change not found.", 404);
});
