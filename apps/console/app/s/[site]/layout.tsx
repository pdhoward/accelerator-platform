import { AppSidebar, SidebarContext, type NavGroup } from "@/components/sidebar";
import { siteAccess, titleCase } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { authEnabled } from "@/lib/supabase";

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const { me, membership, role } = await siteAccess(slug);
  const bridge = await (await serverApi()).bridge(slug);
  const site = bridge.site;
  const base = `/s/${slug}`;

  const groups: NavGroup[] = [
    {
      items: [
        { href: base, label: "Bridge", icon: "activity", badge: bridge.needsYou.length, exact: true },
        { href: `${base}/requests`, label: "Requests", icon: "list", badge: bridge.gauges.openRequests },
        { href: `${base}/change`, label: "Change Room", icon: "split" },
        { href: `${base}/consult`, label: "Consultations", icon: "chat" },
      ],
    },
    {
      title: "Know",
      items: [
        { href: `${base}/proof`, label: "Proof", icon: "flask" },
        { href: `${base}/data`, label: "Data Desk", icon: "database" },
        { href: `${base}/library`, label: "Library", icon: "book" },
        { href: `${base}/health`, label: "Health", icon: "heart" },
        { href: `${base}/releases`, label: "Releases", icon: "history" },
        { href: `${base}/metrics`, label: "Metrics", icon: "chart" },
      ],
    },
    {
      title: "Set up",
      items: [
        { href: `${base}/config`, label: "Configuration", icon: "settings" },
        { href: `${base}/skills`, label: "Skills", icon: "puzzle" },
        { href: `${base}/account`, label: "Account & usage", icon: "card" },
        { href: `${base}/code`, label: "Code", icon: "code", engineer: true },
      ],
    },
  ];

  const links = [
    ...(me.memberships.flatMap((m) => m.sites).length > 1 ? [{ href: "/accounts", label: "Switch site" }] : []),
    ...(me.identity?.platformRole ? [{ href: "/admin", label: "Platform Admin" }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppSidebar
        title="Control Room"
        groups={groups}
        context={
          <SidebarContext
            eyebrow={membership.orgName}
            title={site.url.replace(/^https?:\/\//, "")}
            sub={`${site.status === "live" ? "Live" : "Onboarding"} · ${site.stack}`}
            dot={site.status === "live" ? "good" : "warn"}
          />
        }
        userLabel={`${me.identity?.email ?? "Demo"} · ${titleCase(role)}`}
        links={links}
        engineerToggle
        signOutEnabled={authEnabled}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
