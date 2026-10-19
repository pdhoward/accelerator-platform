import { holdsGates } from "@accelerator/domain";

import { fail, workRoute } from "@/lib/http";
import { startVoiceCall, VoiceUnavailable } from "@/lib/voice";

type P = { siteId: string; number: string };

/**
 * Start a live voice call about this Work item (gen2-crew.md §19.1): a one-call
 * OpenAI pass, grounded in the item's state. The OpenAI key never leaves the server.
 */
export const POST = workRoute<P>(async ({ caller, site, params }) => {
  try {
    const call = await startVoiceCall(site, { name: caller.name, role: caller.role, member: holdsGates(caller) }, Number(params.number));
    return Response.json(call, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof VoiceUnavailable) return fail(err.message, 503);
    throw err;
  }
}, "request.create");
