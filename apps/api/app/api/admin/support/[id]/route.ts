import { json, platformRoute } from "@/lib/http";
import { revokeSupport } from "@/lib/partners";

/** End a support grant early. Audited. */
export const DELETE = platformRoute<{ id: string }>("support.grant", async ({ identity, params }) => {
  await revokeSupport(identity, params.id);
  return json({ ok: true });
});
