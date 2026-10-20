import { CommandComposer } from "@/components/command-composer";
import { AppSidebar, SidebarContext, type NavGroup } from "@/components/sidebar";
import { siteAccess, titleCase } from "@/lib/access";
import { getBridge } from "@/lib/api";
import { authEnabled } from "@/lib/supabase";

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const { me, membership, role, staff, can } = await siteAccess(slug);
  const bridge = await getBridge(slug);
  const site = bridge.site;
  const base = `/s/${slug}`;

  // The four screens (gen2-crew.md §10.4, G2.4): Overview · Work · Site · Crew & Knowledge. Boarding leads
  // while the site is onboarding; Gen 1 pages stay reachable behind Engineer view during the migration.
  const onboarding = site.status === "onboarding";
  const groups: NavGroup[] = [
    ...(onboarding ? [{ title: "Get started", items: [{ href: `${base}/boarding`, label: "Boarding", icon: "setup" as const }] }] : []),
    {
      items: [
        { href: base, label: "Overview", icon: "activity", exact: true },
        { href: `${base}/work`, label: "Work", icon: "work" },
        { href: `${base}/site`, label: "Site", icon: "building" },
        { href: `${base}/crew`, label: "Crew & Knowledge", icon: "users" },
      ],
    },
    {
      title: "Settings",
      items: [
        ...(onboarding ? [] : [{ href: `${base}/boarding`, label: "Boarding", icon: "setup" as const }]),
        { href: `${base}/setup`, label: "Setup", icon: "list" },
        { href: `${base}/config`, label: "Configuration", icon: "settings" },
        { href: `${base}/account`, label: "Account & usage", icon: "card" },
      ],
    },
    {
      title: "Engineer",
      items: [
        { href: `${base}/timeline`, label: "Site Timeline", icon: "scroll", engineer: true },
        { href: `${base}/proof`, label: "Proof", icon: "flask", engineer: true },
        { href: `${base}/health`, label: "Health", icon: "heart", engineer: true },
        { href: `${base}/releases`, label: "Releases", icon: "history", engineer: true },
        { href: `${base}/metrics`, label: "Metrics", icon: "chart", engineer: true },
        { href: `${base}/data`, label: "Data Desk", icon: "database", engineer: true },
        { href: `${base}/library`, label: "Library (Gen 1)", icon: "book", engineer: true },
        { href: `${base}/skills`, label: "Skills (Gen 1)", icon: "puzzle", engineer: true },
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
            eyebrow={staff ? `${membership.orgName} · ${membership.via === "support" ? "support access" : "client"}` : membership.orgName}
            title={site.url.replace(/^https?:\/\//, "")}
            sub={`${site.status === "live" ? "Live" : "Onboarding"} · ${site.stack}`}
            dot={site.status === "live" ? "good" : "warn"}
          />
        }
        userLabel={`${me.identity?.email ?? "Demo"} · ${staff ? membership.partnerName || "Partner" : titleCase(role)}`}
        links={links}
        engineerToggle
        signOutEnabled={authEnabled}
      />
      <main className="min-w-0 flex-1">{children}</main>
      {/* ⌘K: ask the crew from anywhere (gen2-crew.md §17 F5); only where work can actually start. */}
      {authEnabled && can("request.create") && <CommandComposer siteId={slug} />}
    </div>
  );
}
