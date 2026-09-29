import { z } from "zod";

import { body, fail, json, publicRoute } from "@/lib/http";
import { finishSmsSignIn } from "@/lib/identity";

const schema = z.object({ email: z.email(), code: z.string().min(4).max(20) });

/** Right code → a one-time token the console turns into a session. */
export const POST = publicRoute(async ({ request }) => {
  const input = await body(request, schema);
  if (!input) return fail("Enter the code from the text.", 400);
  return json(await finishSmsSignIn(input.email, input.code));
});
