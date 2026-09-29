import { auditList } from "@/lib/admin";
import { json, platformRoute } from "@/lib/http";

export const GET = platformRoute("audit.view", async () => json(await auditList()));
