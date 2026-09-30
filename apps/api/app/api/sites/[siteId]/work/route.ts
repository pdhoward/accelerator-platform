import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { createWork, listWork } from "@/lib/work";

/** Work items: every body of work, on one rail (work/flywheel.md). */
export const GET = workRoute(async ({ site }) => json(await listWork(site.id)));

const schema = z.object({
  title: z.string().trim().min(3).max(120),
  message: z.string().trim().min(3).max(8000),
  risk: z.array(z.enum(["display", "content", "code", "money", "data", "auth", "security"])).max(7).default([]),
});

/** Start a Work item with the first message; the Consult model replies. */
export const POST = workRoute(async ({ request, identity, caller, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Give it a short title and say what you've noticed or want.", 400);
  return json(await createWork(site, identity, caller.name, input), 201);
}, "request.create");
