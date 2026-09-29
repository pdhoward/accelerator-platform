import { z } from "zod";

import { body, fail, json, publicRoute } from "@/lib/http";
import { sendEmailSignIn } from "@/lib/identity";

const schema = z.object({ email: z.email(), next: z.string().max(300).optional() });

/** Email a one-time sign-in link (invite-only; the link points at our Control Room). */
export const POST = publicRoute(async ({ request }) => {
  const input = await body(request, schema);
  if (!input) return fail("Enter a valid email address.", 400);
  return json(await sendEmailSignIn(input.email, input.next));
});
