import { holdsGates } from "@accelerator/domain";
import { z } from "zod";

import { decideProposal } from "@/lib/crew";
import { body, fail, json, workRoute } from "@/lib/http";

type P = { siteId: string; proposalId: string };

/** Approve, decline or roll back a skill proposal: the tier owner's decision (company and site skills: the client). */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, z.object({ decision: z.enum(["approve", "reject", "rollback"]) }));
  if (!input) return fail("Approve, decline or roll back.", 400);
  if (!holdsGates(caller)) return fail(`The client decides what the crew learns; ${caller.partnerName ?? "partner"} staff can propose.`, 403);
  await decideProposal(site, identity, caller.name, params.proposalId, input.decision);
  return json({ ok: true });
}, "skills.manage");
