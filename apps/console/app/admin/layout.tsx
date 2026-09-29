import type { PlatformAction } from "@accelerator/domain";

import { AppSidebar, SidebarContext, type NavItem } from "@/components/sidebar";
import { platformAccess, titleCase } from "@/lib/access";
import { authEnabled } from "@/lib/supabase";

/** Each admin item and the permission it needs (see PLATFORM_PERMISSIONS). */
const NAV: (NavItem & { needs: PlatformAction })[] = [
  { href: "/admin", label: "Overview", icon: "gauge", exact: true, needs: "platform.view" },
  { href: "/admin/accounts", label: "Accounts", icon: "building", needs: "platform.view" },
  { href: "/admin/audit", label: "Audit log", icon: "scroll", needs: "audit.view" },
  { href: "/admin/team", label: "Team", icon: "users", needs: "team.manage" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { me, role, can } = await platformAccess();
  const items = NAV.filter((n) => can(n.needs)).map(({ needs: _, ...item }) => item);
  const hasSites = me.memberships.some((m) => m.sites.length);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppSidebar
        title="Platform Admin"
        groups={[{ items }]}
        context={<SidebarContext eyebrow="Strategic Machines" title="All accounts" sub={`${me.stage} · ${titleCase(role)}`} dot="violet" />}
        userLabel={`${me.identity?.email} · ${titleCase(role)}`}
        links={hasSites ? [{ href: "/accounts", label: "Open a Control Room" }] : []}
        signOutEnabled={authEnabled}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
