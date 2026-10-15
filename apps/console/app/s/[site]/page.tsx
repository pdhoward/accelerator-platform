import { ExecutiveBriefing } from "@/components/workspace/executive-briefing";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
export const metadata = { title: "Executive Briefing" };
export default async function BriefingPage({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;
  const { can } = await siteAccess(site);
  const briefing = await (await serverApi()).briefing(site);
  return (
    <ExecutiveBriefing
      key={site}
      siteId={site}
      initial={briefing}
      canCreate={can("request.create")}
    />
  );
}
