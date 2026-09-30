import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { signAgreement } from "@/lib/work";

const schema = z.object({ body: z.string().trim().min(50).max(20_000) });

/** The Navigator signs the working agreement (a new version each time). */
export const POST = workRoute(async ({ request, identity, caller, site }) => {
  if (caller.staff) return fail("The customer's Navigator signs the agreement.", 403);
  const input = await body(request, schema);
  if (!input) return fail("The agreement text is missing.", 400);
  await signAgreement(site, identity, input.body);
  return json({ ok: true }, 201);
}, "config.manage");
