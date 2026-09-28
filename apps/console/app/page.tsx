import { redirect } from "next/navigation";

import { serverApi } from "@/lib/api";

/** Home: open the caller's first site's Control Room. */
export default async function Home() {
  const { sites } = await serverApi().me();
  const first = sites[0];
  redirect(first ? `/s/${first.slug}` : "/onboarding");
}
