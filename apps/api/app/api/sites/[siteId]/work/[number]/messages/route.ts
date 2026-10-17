import { z } from "zod";

import { holdsGates } from "@accelerator/domain";

import { body, fail, json, workRoute } from "@/lib/http";
import { postMessage } from "@/lib/work";

type P = { siteId: string; number: string };

/** `shown`: the key of the decision card the person was looking at, so a typed "approve" binds to it. */
const schema = z.object({ body: z.string().trim().min(1).max(8000), shown: z.string().max(200).optional() });

/** Say something in the thread: the lead replies, or a typed approve / stop / resume is applied (gen2-crew.md §17.4). */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Write a message.", 400);
  await postMessage(site, identity, { name: caller.name, role: caller.role, member: holdsGates(caller) }, Number(params.number), input.body, input.shown);
  return json({ ok: true }, 201);
}, "request.create");
