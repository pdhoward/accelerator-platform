import { z } from "zod";

import { body, fail, json, publicRoute } from "@/lib/http";
import { mayStartSignIn } from "@/lib/identity";

const schema = z.object({ email: z.email() });

/** Invite-only gate, asked before the console sends a magic link. */
export const POST = publicRoute(async ({ request }) => {
  const input = await body(request, schema);
  if (!input) return fail("Enter a valid email address.", 400);
  return json({ allowed: await mayStartSignIn(input.email) });
});
