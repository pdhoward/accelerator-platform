import { runSkillsmith } from "@/lib/crew";
import { json, workRoute } from "@/lib/http";

/** Ask the Skillsmith to read the evidence now (it also runs after every release). Proposals only. */
export const POST = workRoute(async ({ site }) => json({ proposed: await runSkillsmith(site) }), "config.manage");
