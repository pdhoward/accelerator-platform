import { json, workRoute } from "@/lib/http";
import { runCheckout } from "@/lib/work";

/** Ask the engine to prove it's ready (C1–C7). */
export const POST = workRoute(async ({ identity, site }) => {
  await runCheckout(site, identity);
  return json({ ok: true }, 202);
}, "config.manage");
