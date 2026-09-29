import { fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

export const GET = siteRoute<{ siteId: string; docId: string }>(async ({ site, params }) => {
  const doc = await store.doc(site.id, params.docId);
  return doc ? json(doc) : fail("Document not found.", 404);
});
