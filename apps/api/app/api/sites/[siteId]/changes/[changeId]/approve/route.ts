import { z } from "zod";

import { fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

const schema = z.object({ checked: z.array(z.string()).max(50) });

/** Approve after trying. Gate policy (packages/domain) decides whether it can ship. */
export const POST = siteRoute<{ params: Promise<{ siteId: string; changeId: string }> }>(
  async ({ request, site, caller, params }) => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Invalid checklist.", 400);
    const result = await store.approveChange(site.id, params.changeId, parsed.data.checked, caller);
    if (!result.ok) return fail(result.error, result.status);
    return json({ change: result.change, blockers: result.blockers });
  },
);
