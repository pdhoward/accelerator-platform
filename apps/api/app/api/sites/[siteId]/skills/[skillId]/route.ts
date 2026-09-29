import { z } from "zod";

import { body, fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

const schema = z.object({ enabled: z.boolean() });

export const PATCH = siteRoute<{ siteId: string; skillId: string }>(async ({ request, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Send { enabled: true | false }.", 400);
  const skill = await store.toggleSkill(site.id, params.skillId, input.enabled);
  return skill ? json(skill) : fail("Skill not found.", 404);
}, "skills.manage");
