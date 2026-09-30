import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { setCadence, workDetail } from "@/lib/work";

type P = { siteId: string; number: string };

export const GET = workRoute<P>(async ({ site, params }) => json(await workDetail(site, Number(params.number))));

const schema = z.object({ cadence: z.enum(["every_step", "at_risk", "run"]) });

/** How often the engine stops to ask (F9). */
export const PATCH = workRoute<P>(async ({ request, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Pick a cadence.", 400);
  await setCadence(site, Number(params.number), input.cadence);
  return json({ ok: true });
}, "change.approve");
