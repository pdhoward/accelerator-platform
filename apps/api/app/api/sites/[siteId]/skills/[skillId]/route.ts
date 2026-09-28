import { z } from "zod";

import { fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

const schema = z.object({ enabled: z.boolean() });

export const PATCH = siteRoute<{ params: Promise<{ siteId: string; skillId: string }> }>(
  async ({ request, site, caller, params }) => {
    if (caller.role !== "owner" && caller.role !== "operator") return fail("Only the Owner or an Operator can change skills.", 403);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Send { enabled: true | false }.", 400);
    const skill = await store.toggleSkill(site.id, params.skillId, parsed.data.enabled);
    return skill ? json(skill) : fail("Skill not found.", 404);
  },
);
