import { notFound } from "next/navigation";
import { ApiError } from "@accelerator/api-client";

import { WorkRoom } from "@/components/work-room";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";

export const metadata = { title: "Work item" };

export default async function WorkItemPage({ params }: { params: Promise<{ site: string; n: string }> }) {
  const { site, n } = await params;
  const { can } = await siteAccess(site);
  const detail = await (await serverApi()).work.get(site, Number(n)).catch((err) => {
    if (err instanceof ApiError && (err.status === 400 || err.status === 404)) notFound();
    throw err;
  });
  return <WorkRoom siteId={site} initial={detail} canAsk={can("request.create")} canApprove={can("change.approve")} />;
}
