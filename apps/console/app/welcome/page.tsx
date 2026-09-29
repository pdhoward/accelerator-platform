import { AuthShell, SignOutLink } from "@/components/auth-shell";
import { getMe } from "@/lib/api";

export const metadata = { title: "Invite-only" };

/** Signed in, but on no account yet. */
export default async function WelcomePage() {
  const me = await getMe();
  return (
    <AuthShell title="You're signed in" sub={me.identity?.email}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-fog">
        <p>The Control Room is invite-only for now, and this email isn&apos;t on an account yet.</p>
        <p>
          If your team uses the Accelerator, ask its owner to invite this address. To bring a new site aboard, write to{" "}
          <a className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-fog" href="mailto:hello@strategicmachines.ai">
            hello@strategicmachines.ai
          </a>
          .
        </p>
        <SignOutLink label="Sign in with a different email" />
      </div>
    </AuthShell>
  );
}
