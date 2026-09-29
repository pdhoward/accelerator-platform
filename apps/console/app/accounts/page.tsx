import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { AuthShell, SignOutLink } from "@/components/auth-shell";
import { Chip } from "@/components/ui";
import { titleCase } from "@/lib/access";
import { getMe } from "@/lib/api";
import { authEnabled } from "@/lib/supabase";

export const metadata = { title: "Choose a site" };

const row = "flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 transition-colors hover:border-line-2 hover:bg-panel-2";

/** The picker, for people on more than one site (and platform staff). */
export default async function AccountsPage() {
  const me = await getMe();

  return (
    <AuthShell title="Choose a site" sub={me.identity?.email}>
      <div className="flex flex-col gap-2">
        {me.identity?.platformRole && (
          <Link href="/admin" className={row}>
            <ShieldCheck className="size-4 text-violet" />
            <span className="flex-1 font-medium">Platform Admin</span>
            <Chip tone="violet">{titleCase(me.identity.platformRole)}</Chip>
          </Link>
        )}
        {me.memberships.flatMap((m) =>
          m.sites.map((s) => {
            const suspended = m.status === "suspended";
            return (
              <Link key={s.id} href={suspended ? "/suspended" : `/s/${s.slug}`} className={row}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-mist">
                    {m.orgName} · {s.url.replace(/^https?:\/\//, "")}
                  </span>
                </span>
                {suspended ? <Chip tone="bad">Suspended</Chip> : <Chip>{titleCase(m.role)}</Chip>}
                <ArrowRight className="size-4 text-mist" />
              </Link>
            );
          }),
        )}
      </div>
      {authEnabled && (
        <div className="mt-6 flex justify-center">
          <SignOutLink />
        </div>
      )}
    </AuthShell>
  );
}
