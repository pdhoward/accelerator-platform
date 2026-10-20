import { z } from "zod";

import { setSkillEnabled } from "@/lib/crew";
import { body, fail, json, workRoute } from "@/lib/http";

type P = { siteId: string; skillId: string };

/** Switch a company or site skill on or off. */
export const PATCH = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, z.object({ enabled: z.boolean() }));
  if (!input) return fail("Say on or off.", 400);
  await setSkillEnabled(site, identity, caller.name, params.skillId, input.enabled);
  return json({ ok: true });
}, "skills.manage");
