import { accountDetail } from "@/lib/admin";
import { fail, json, platformRoute } from "@/lib/http";

export const GET = platformRoute<{ id: string }>("platform.view", async ({ params }) => {
  const detail = await accountDetail(params.id);
  return detail ? json(detail) : fail("Account not found.", 404);
});
