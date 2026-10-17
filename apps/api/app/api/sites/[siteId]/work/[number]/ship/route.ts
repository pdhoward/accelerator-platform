import { canSite, holdsGates } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { approveTry, beginWork, cancelWork, closeWork, proveWork, releaseWork, shipWork } from "@/lib/work";

type P = { siteId: string; number: string };

const schema = z.object({ action: z.enum(["begin", "prove", "approve", "ship", "release", "close", "cancel"]) });

/**
 * Starting and finishing work: Begin (Low: start building now), Prove (retry a
 * failed Prove), Try (High's gate 3), Ship it (Medium: approve the preview and
 * release it), Release (High's Go live, or a retry) and Close; or Cancel at any
 * stop before release. Only the account's own people decide, except that
 * partner staff may begin Low items and cancel items they started. Releasing
 * needs the release.ship permission.
 */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Unknown action.", 400);
  const n = Number(params.number);
  const member = holdsGates(caller);
  if (input.action === "cancel") {
    await cancelWork(site, identity, caller.name, n, member);
    return json({ ok: true });
  }
  if (input.action === "begin") {
    await beginWork(site, identity, caller.name, n);
    return json({ ok: true });
  }
  if (!member) return fail(`The Navigator decides; ${caller.partnerName ?? "partner"} staff can discuss and draft.`, 403);
  if (!canSite(caller.role, "change.approve")) return fail("Your role can't move work past this stop. Ask an Owner or Operator.", 403);
  switch (input.action) {
    case "prove":
      await proveWork(site, identity, n);
      break;
    case "approve":
      await approveTry(site, identity, caller.name, caller.role, n);
      break;
    case "ship":
      if (!canSite(caller.role, "release.ship")) return fail("Your role can't release to production. Ask an Owner or Operator.", 403);
      await shipWork(site, identity, caller.name, caller.role, n);
      break;
    case "release":
      if (!canSite(caller.role, "release.ship")) return fail("Your role can't release to production. Ask an Owner or Operator.", 403);
      await releaseWork(site, identity, caller.name, n);
      break;
    case "close":
      await closeWork(site, identity, caller.name, n);
      break;
  }
  return json({ ok: true });
}, "request.create");
