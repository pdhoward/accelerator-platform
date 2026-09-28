import { notFound } from "next/navigation";

import { Sidebar } from "@/components/sidebar";
import { serverApi } from "@/lib/api";

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const api = serverApi();
  const { caller, sites } = await api.me();
  const site = sites.find((s) => s.slug === slug);
  if (!site) notFound();

  const bridge = await api.bridge(site.id);
  const roleLabel = caller.role[0]!.toUpperCase() + caller.role.slice(1);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        site={site}
        userLabel={`Signed in as ${caller.name} · ${roleLabel}`}
        counts={{ requests: bridge.gauges.openRequests, needsYou: bridge.needsYou.length }}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
