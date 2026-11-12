import { z } from "zod";

import { updateSite } from "@/lib/admin";
import { body, fail, json, platformRoute } from "@/lib/http";

type P = { id: string; siteId: string };

const source = z.object({
  label: z.string().trim().min(1).max(80),
  repo: z.string().trim().max(300).nullable(),
  path: z.string().trim().max(500).nullable(),
  url: z.string().trim().max(300).nullable(),
});
const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    url: z.string().trim().max(300),
    description: z.string().trim().max(1000).nullable(),
    repo: z.string().trim().max(300).nullable(),
    repoPath: z.string().trim().max(500).nullable(),
    sources: z.array(source).max(20),
  })
  .partial();

/** Edit a site: name, live address, description, primary repository, and the other code the system lives in. */
export const PATCH = platformRoute<P>("accounts.manage", async ({ request, identity, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Check the site's details and its code sources.", 400);
  await updateSite(identity, params.id, params.siteId, input);
  return json({ ok: true });
});
