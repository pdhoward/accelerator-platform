import { VAULT_ENVS } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { removeSecret, secretStatus, setSecret } from "@/lib/vault";

/** Which keys are set (never their values). */
export const GET = workRoute(async ({ site }) => json(await secretStatus(site.id)), "config.manage");

const schema = z.object({
  environment: z.enum(VAULT_ENVS),
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "Key names are UPPER_SNAKE_CASE."),
  value: z.string().max(20_000).nullable(),
});

/** Set a value (encrypted on arrival) or remove it (value: null). */
export const PUT = workRoute(async ({ request, identity, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Check the key name and value.", 400);
  if (input.value === null) await removeSecret(site.id, input.environment, input.name);
  else await setSecret(site, identity.userId, input.environment, input.name, input.value);
  return json(await secretStatus(site.id));
}, "config.manage");
