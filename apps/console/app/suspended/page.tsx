import Link from "next/link";

import { AuthShell, SignOutLink } from "@/components/auth-shell";
import { getMe } from "@/lib/api";

export const metadata = { title: "Account suspended" };

export default async function SuspendedPage() {
  const me = await getMe();
  const others = me.memberships.filter((m) => m.status !== "suspended" && m.sites.length).length;
  return (
    <AuthShell title="This account is paused" sub="Your site keeps running; the Control Room is read-locked.">
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-fog">
        <p>
          Work on this account is suspended. Nothing has been deleted. To resume, contact{" "}
          <a className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-fog" href="mailto:hello@strategicmachines.ai">
            hello@strategicmachines.ai
          </a>
          .
        </p>
        {(others > 0 || me.identity?.platformRole) && (
          <Link href="/accounts" className="text-ink hover:text-cyan">
            Go to your other sites →
          </Link>
        )}
        <SignOutLink />
      </div>
    </AuthShell>
  );
}
