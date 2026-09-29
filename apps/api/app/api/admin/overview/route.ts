import { overview } from "@/lib/admin";
import { json, platformRoute } from "@/lib/http";

export const GET = platformRoute("platform.view", async ({ identity }) => json(await overview(identity)));
