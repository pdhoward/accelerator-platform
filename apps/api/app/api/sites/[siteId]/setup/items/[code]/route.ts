import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { setSetupItem } from "@/lib/work";

type P = { siteId: string; code: string };

const schema = z.object({ status: z.enum(["todo", "waiting", "done", "failed", "not_needed"]), note: z.string().max(1000).optional() });

/** Tick an Install item (people do these; the engine proves the Checkout ones). */
export const POST = workRoute<P>(async ({ request, identity, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Pick a status.", 400);
  await setSetupItem(site, identity, params.code.toUpperCase(), input.status, input.note);
  return json({ ok: true });
}, "config.manage");
