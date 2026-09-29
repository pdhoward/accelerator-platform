import { z } from "zod";

import { setAccountStatus } from "@/lib/admin";
import { body, fail, json, platformRoute } from "@/lib/http";

const schema = z.object({ action: z.enum(["suspend", "resume"]), reason: z.string().trim().min(3).max(500) });

/** Suspend or resume an account. A reason is required; both are audited. */
export const POST = platformRoute<{ id: string }>("accounts.suspend", async ({ request, identity, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Give a reason (at least a few words).", 400);
  await setAccountStatus(identity, params.id, input.action, input.reason);
  return json({ ok: true });
});
