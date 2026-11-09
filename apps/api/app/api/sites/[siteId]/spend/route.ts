import { json, siteRoute } from "@/lib/http";
import { siteSpend } from "@/lib/spend";

/** The site's spend scorecard: what its AI work cost over the last `days` (default 30), and which work cost it. */
export const GET = siteRoute(async ({ request, site }) => {
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  return json(await siteSpend(site, days));
});
