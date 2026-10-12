import { canSite, holdsGates } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { approveTry, closeWork, proveWork, releaseWork } from "@/lib/work";

type P = { siteId: string; number: string };

const schema = z.object({ action: z.enum(["prove", "approve", "release", "close"]) });

/**
 * The last stops of the rail (flywheel.md F14): Prove (the engine checks,
 * pushes and opens a preview), Try (gate 3: the Navigator approves the
 * preview), Release (Go live) and Close. Only the account's own people
 * decide; Release needs the release.ship permission.
 */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Unknown action.", 400);
  if (!holdsGates(caller)) return fail(`The Navigator decides; ${caller.partnerName ?? "partner"} staff can discuss and draft.`, 403);
  const n = Number(params.number);
  switch (input.action) {
    case "prove":
      await proveWork(site, identity, n);
      break;
    case "approve":
      await approveTry(site, identity, caller.name, caller.role, n);
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
}, "change.approve");
