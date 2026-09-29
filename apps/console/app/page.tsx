import { redirect } from "next/navigation";
import { ApiError } from "@accelerator/api-client";

import { homeFor } from "@/lib/access";
import { getMe } from "@/lib/api";

/** Home routes each person to the right place (see homeFor). */
export default async function Home() {
  const me = await getMe().catch((err) => {
    if (err instanceof ApiError && err.status === 401) redirect("/login?error=Your+session+has+ended.+Sign+in+again.");
    throw err;
  });
  redirect(homeFor(me));
}
