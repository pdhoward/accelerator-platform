import { z } from "zod";

import { invite } from "@/lib/admin";
import { body, fail, json, platformRoute } from "@/lib/http";

const schema = z.object({ email: z.email(), role: z.enum(["owner", "operator", "tester", "viewer"]) });

export const POST = platformRoute<{ id: string }>("accounts.manage", async ({ request, identity, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Enter an email and a role.", 400);
  await invite(identity, params.id, input.email, input.role);
  return json({ ok: true }, 201);
});
