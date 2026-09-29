import { z } from "zod";

import { body, fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

const schema = z.object({ checked: z.array(z.string()).max(50) });

/** Approve after trying. The role needs change.approve; gate policy decides whether it can ship. */
export const POST = siteRoute<{ siteId: string; changeId: string }>(async ({ request, site, caller, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Invalid checklist.", 400);
  const result = await store.approveChange(site.id, params.changeId, input.checked, caller);
  if (!result.ok) return fail(result.error, result.status);
  return json({ change: result.change, blockers: result.blockers });
}, "change.approve");
