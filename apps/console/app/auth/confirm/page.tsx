import { AuthShell } from "@/components/auth-shell";
import { button } from "@/components/ui";

import { confirmSignIn } from "./actions";

export const metadata = { title: "Sign in" };

/**
 * The emailed sign-in link lands here. Opening it signs no one in: the token
 * is used only when the person presses Continue, so a mail scanner that opens
 * the link first (Outlook, Hotmail) can't spend it.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; next?: string }> }) {
  const { token_hash: tokenHash, next } = await searchParams;
  return (
    <AuthShell title="Sign in to the Control Room" sub={tokenHash ? "One more step: confirm it's you." : "This link is incomplete. Request a new one."}>
      {tokenHash ? (
        <form action={confirmSignIn} className="flex flex-col gap-3">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="next" value={next ?? ""} />
          <button type="submit" className={button("gold", "w-full justify-center py-2.5")} autoFocus>
            Continue to the Control Room
          </button>
          <p className="text-[12.5px] text-mist">The link works once and expires an hour after it was sent.</p>
        </form>
      ) : (
        <a href="/login" className={button("plain", "w-full justify-center py-2.5")}>Back to sign in</a>
      )}
    </AuthShell>
  );
}
