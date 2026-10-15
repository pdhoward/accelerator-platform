import { siteRoute } from "../../../../../../../lib/http";
import { readStudio } from "../../../../../../../lib/studio";
export const GET = siteRoute<{ siteId: string; number: string }>(
  async ({ site, params }) =>
    Response.json(await readStudio(site, Number(params.number)), {
      headers: { "Cache-Control": "private, no-store" },
    }),
);
