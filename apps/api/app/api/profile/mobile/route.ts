import { z } from "zod";

import { body, fail, json, identityRoute } from "@/lib/http";
import { startMobile } from "@/lib/identity";

const schema = z.object({ mobile: z.string().min(6).max(30), consentText: z.string().min(10).max(500) });

/** Save the mobile (international, E.164) + SMS consent, and text a code to confirm it. */
export const POST = identityRoute(async ({ request, identity }) => {
  const input = await body(request, schema);
  if (!input) return fail("Enter your mobile number and accept text messages.", 400);
  return json(await startMobile(identity, input.mobile, input.consentText));
});
