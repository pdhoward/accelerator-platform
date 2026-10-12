import { SUPPORT_GRANT_MAX_HOURS } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, platformRoute } from "@/lib/http";
import { grantSupport, liveSupportGrants } from "@/lib/partners";

/** Live support grants: the only way platform staff reach a partner's clients (gen2-crew.md §5). */
export const GET = platformRoute("support.grant", async () => json(await liveSupportGrants()));

const schema = z
  .object({
    toEmail: z.email(),
    orgId: z.uuid().optional(),
    partnerId: z.uuid().optional(),
    reason: z.string().trim().min(3).max(500),
    hours: z.number().int().min(1).max(SUPPORT_GRANT_MAX_HOURS),
  })
  .refine((v) => !v.orgId !== !v.partnerId, "One account or one partner.");

/** Grant time-boxed support access to one account, or to all of one partner's accounts. Audited. */
export const POST = platformRoute("support.grant", async ({ request, identity }) => {
  const input = await body(request, schema);
  if (!input) return fail(`Name one account or one partner, a reason, and 1–${SUPPORT_GRANT_MAX_HOURS} hours.`, 400);
  return json(await grantSupport(identity, input), 201);
});
