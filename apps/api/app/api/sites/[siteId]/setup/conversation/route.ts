import { json, workRoute } from "@/lib/http";
import { installConversation } from "@/lib/work";

/** Open (or create) this site's installation conversation with the engine. */
export const POST = workRoute(async ({ identity, caller, site }) => json(await installConversation(site, identity, caller.name)), "config.manage");
