import { json, siteRoute } from "@/lib/http";
import { mintRuntimeToken } from "@/lib/runtime";

/**
 * The connection a site's own app uses to read its policy book at runtime
 * (backlog B4): this API's address and the site's runtime token. Owners and
 * operators only (config.manage), like the site's other keys.
 */
export const GET = siteRoute(async ({ request, site }) => {
  const res = json({ url: new URL(request.url).origin, token: mintRuntimeToken(site.id), env: { url: "CRADLE_API_URL", token: "CRADLE_TOKEN" } });
  res.headers.set("Cache-Control", "no-store");
  return res;
}, "config.manage");
