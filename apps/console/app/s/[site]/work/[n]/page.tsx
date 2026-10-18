import { notFound } from "next/navigation";
import { ApiError } from "@accelerator/api-client";

import { WorkRoom } from "@/components/work-room";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";

export const metadata = { title: "Work item" };

export default async function WorkItemPage({
  params,
}: {
  params: Promise<{ site: string; n: string }>;
}) {
  const { site, n } = await params;
  const { can, staff, membership, role } = await siteAccess(site);
  const api = await serverApi();
  // The item's own dial: a read that fails leaves the dial out, never the page.
  const instruments = api.instruments(site, Number(n)).catch(() => null);
  const detail = await api.work
    .studio(site, Number(n))
    .catch((err) => {
      if (err instanceof ApiError && (err.status === 400 || err.status === 404))
        notFound();
      throw err;
    });
  return (
    <WorkRoom
      key={`${site}:${n}`}
      siteId={site}
      initial={detail.detail}
      initialStudio={detail.studio}
      instruments={await instruments}
      access={{ via: membership.via, role }}
      canAsk={detail.studio.source !== "sample" && can("request.create")}
      canApprove={
        detail.studio.source !== "sample" && !staff && can("change.approve")
      }
      canShip={
        detail.studio.source !== "sample" && !staff && can("release.ship")
      }
    />
  );
}
