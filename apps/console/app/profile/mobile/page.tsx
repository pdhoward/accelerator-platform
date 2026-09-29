import { redirect } from "next/navigation";

import { AuthShell, SignOutLink } from "@/components/auth-shell";
import { getMe } from "@/lib/api";

import { MobileForm } from "./mobile-form";

export const metadata = { title: "Your mobile number" };

export default async function MobilePage() {
  const me = await getMe();
  if (me.mode === "demo") redirect("/");

  return (
    <AuthShell title="Add your mobile number" sub="Used to text you sign-in codes and alerts that need you. Any country.">
      <MobileForm current={me.profile?.mobileMasked ?? null} />
      <div className="mt-6 flex justify-center">
        <SignOutLink />
      </div>
    </AuthShell>
  );
}
