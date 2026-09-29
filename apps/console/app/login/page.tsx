import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { appStage } from "@/lib/env";
import { authEnabled } from "@/lib/supabase";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (!authEnabled) redirect("/"); // local demo has no sign-in
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <AuthShell title="Sign in" sub="Use your work email. We'll email you a link or text you a code.">
      {error && <p className="mb-4 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-[13px] text-bad">{error}</p>}
      <LoginForm next={safeNext} allowReserve={appStage() !== "production"} />
    </AuthShell>
  );
}
