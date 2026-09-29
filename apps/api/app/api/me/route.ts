import type { Me } from "@accelerator/domain";

import { demoMode } from "@/lib/auth";
import { stage } from "@/lib/env";
import { json, identityRoute } from "@/lib/http";
import { profile, settle } from "@/lib/identity";
import { store } from "@/lib/store";

/** Who am I, and where can I go? First call after sign-in also settles invites. */
export const GET = identityRoute(async ({ identity }) => {
  if (!demoMode()) await settle(identity);
  const me: Me = {
    identity,
    profile: demoMode() ? null : await profile(identity.userId),
    memberships: await store.memberships(identity),
    mode: demoMode() ? "demo" : "live",
    stage: stage(),
  };
  return json(me);
});
