import { z } from "zod";

import { fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

export const GET = siteRoute(async ({ site }) => json(await store.requests(site.id)));

const createSchema = z.object({ text: z.string().trim().min(3).max(4000), source: z.string().max(60).optional() });

export const POST = siteRoute(async ({ request, site, caller }) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Describe the request in at least a few words.", 400);
  return json(await store.createRequest(site.id, parsed.data.text, parsed.data.source ?? caller.name, caller), 201);
});
