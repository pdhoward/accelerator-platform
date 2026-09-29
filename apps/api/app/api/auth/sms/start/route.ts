import { z } from "zod";

import { body, fail, json, publicRoute } from "@/lib/http";
import { startSmsSignIn } from "@/lib/identity";

const schema = z.object({ email: z.email() });

/** Text a sign-in code to the member's verified mobile. */
export const POST = publicRoute(async ({ request }) => {
  const input = await body(request, schema);
  if (!input) return fail("Enter a valid email address.", 400);
  return json(await startSmsSignIn(input.email));
});
