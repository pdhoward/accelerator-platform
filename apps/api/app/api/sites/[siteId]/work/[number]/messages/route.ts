import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { postMessage } from "@/lib/work";

type P = { siteId: string; number: string };

const schema = z.object({ body: z.string().trim().min(1).max(8000) });

/** Say something in the thread; the Consult model replies. */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Write a message.", 400);
  await postMessage(site, identity, caller.name, Number(params.number), input.body);
  return json({ ok: true }, 201);
}, "request.create");
