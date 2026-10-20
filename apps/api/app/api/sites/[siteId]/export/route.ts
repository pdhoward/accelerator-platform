import { workRoute } from "@/lib/http";
import { exportSite } from "@/lib/library";

/** The site's whole record as one JSON file (gen2-crew.md §2.4): decisions, documents, evidence, ledger and more. Never secrets. */
export const GET = workRoute(async ({ caller, site }) => {
  const data = await exportSite(site, caller.name);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${site.slug}-accelerator-record-${day}.json"`,
      "cache-control": "private, no-store",
    },
  });
}, "config.manage");
