import { z } from "zod";

import { removeMember, updateMember } from "@/lib/admin";
import { body, fail, json, platformRoute } from "@/lib/http";

type P = { id: string; memberId: string };

const schema = z
  .object({ name: z.string().trim().min(1).max(80), email: z.email(), role: z.enum(["owner", "operator", "tester", "viewer"]) })
  .partial();

export const PATCH = platformRoute<P>("accounts.manage", async ({ request, identity, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Check the name, email and role.", 400);
  await updateMember(identity, params.id, params.memberId, input);
  return json({ ok: true });
});

export const DELETE = platformRoute<P>("accounts.manage", async ({ identity, params }) => {
  await removeMember(identity, params.id, params.memberId);
  return json({ ok: true });
});
