import { z } from "zod";

import { editCapability, reviewCapability } from "@/lib/capabilities";
import { body, fail, json, workRoute } from "@/lib/http";

type P = { siteId: string; capabilityId: string };

const schema = z.union([
  z.object({ action: z.enum(["accept", "restore"]) }),
  z.object({ action: z.literal("retire"), reason: z.string().min(1).max(300) }),
  z.object({ action: z.literal("edit"), values: z.record(z.string(), z.unknown()) }),
]);

/** A person's review of one capability: accept a proposal, edit it, retire it (with the reason) or restore it. */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Unknown action.", 400);
  if (input.action === "edit") await editCapability(site, identity, caller.name, params.capabilityId, input.values);
  else await reviewCapability(site, identity, caller.name, params.capabilityId, input.action, input.action === "retire" ? input.reason : undefined);
  return json({ ok: true });
}, "config.manage");
