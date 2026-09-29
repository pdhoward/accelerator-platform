import { z } from "zod";

import { body, fail, json, identityRoute } from "@/lib/http";
import { verifyMobile } from "@/lib/identity";

const schema = z.object({ code: z.string().min(4).max(20) });

export const POST = identityRoute(async ({ request, identity }) => {
  const input = await body(request, schema);
  if (!input) return fail("Enter the code from the text.", 400);
  await verifyMobile(identity, input.code);
  return json({ ok: true });
});
