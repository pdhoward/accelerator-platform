import { canSite, holdsGates } from "@accelerator/domain";

import { fail, json, workRoute } from "@/lib/http";
import { draftMandate, mandateHistory, saveMandate } from "@/lib/mandate";
import { db, rows } from "@/lib/supabase";

type P = { siteId: string; number: string };

/** The Work item's mandate (gen2-crew.md §10.1): the current version, its history, and a draft from the approved Brief. */
export const GET = workRoute<P>(async ({ site, params }) => {
  const n = Number(params.number);
  const [w] = await rows(db().from("acc_work").select("id").eq("site_id", site.id).eq("number", n));
  if (!w) return fail("That work item doesn't exist.", 404);
  const history = await mandateHistory(w.id as string);
  return json({ current: history[0] ?? null, history, draft: history[0] ? null : await draftMandate(site, n) });
});

/** A new mandate version: a decision about authority, so it belongs to the account's own people. */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  if (!holdsGates(caller)) return fail(`The client sets the mandate; ${caller.partnerName ?? "partner"} staff can draft it in the conversation.`, 403);
  if (!canSite(caller.role, "change.approve")) return fail("Your role can't set a mandate. Ask an Owner or Operator.", 403);
  return json(await saveMandate(site, identity, caller.name, Number(params.number), await request.json().catch(() => null)));
}, "request.create");
