import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { saveModels, siteModels } from "@/lib/work";

/** The model for each job on this site (F15). */
export const GET = workRoute(async ({ site }) => json(await siteModels(site.id)));

const schema = z.object({
  models: z
    .array(
      z.object({
        role: z.enum(["consult", "design", "plan", "build", "judge"]),
        provider: z.enum(["anthropic", "openai", "xai", "google"]),
        model: z.string().trim().min(2).max(80),
        keySource: z.enum(["ours", "customer"]),
      }),
    )
    .min(1)
    .max(5),
});

export const PUT = workRoute(async ({ request, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Check the model settings.", 400);
  await saveModels(site, input.models);
  return json(await siteModels(site.id));
}, "config.manage");
