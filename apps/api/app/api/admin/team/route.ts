import { team } from "@/lib/admin";
import { json, platformRoute } from "@/lib/http";

export const GET = platformRoute("team.manage", async () => json(await team()));
