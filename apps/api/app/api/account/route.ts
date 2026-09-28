import { resolveCaller } from "@/lib/auth";
import { json } from "@/lib/http";
import { store } from "@/lib/store";

export async function GET(request: Request) {
  const caller = await resolveCaller(request);
  return json(await store.account(caller.orgId));
}
