import type { ReactNode } from "react";

import { signOut } from "@/app/login/actions";

import { CyclingWord } from "./cycling-word";
import { Logo } from "./logo";

const VERBS = ["manage", "design", "change", "validate", "inspect", "approve", "release", "govern", "improve"] as const;

/**
 * The split-screen frame for every signed-out / setup screen: product
 * statement on the left, the task on the right. One look, reused.
 */
export function AuthShell({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-panel p-12 lg:flex">
        <div className="pointer-events-none absolute -left-32 -top-32 size-[520px] rounded-full bg-violet/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 right-0 size-[420px] rounded-full bg-cyan/15 blur-[120px]" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-semibold tracking-tight">The Accelerator</span>
        </div>
        <div className="relative max-w-lg">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-mist">The AI Control Room for your website</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-[2.75rem]">
            <span className="block">
              You <CyclingWord words={VERBS} wordClassName="bg-gradient-to-r from-violet to-cyan bg-clip-text text-transparent" /> your website.
            </span>
            <span className="block text-fog">AI delivers the outcome.</span>
          </h1>
          <p className="mt-4 text-fog">From requirement to release, every action is controlled, tested, and backed by evidence.</p>
        </div>
        <p className="relative text-xs text-mist">Strategic Machines · invite-only</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={36} />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          {sub && <p className="mt-1.5 text-[13.5px] text-fog">{sub}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}

export const fieldClass =
  "w-full rounded-xl border border-line-2 bg-panel-2 px-3.5 py-2.5 text-ink placeholder:text-mist focus:border-violet focus:outline-none";

/** "Sign out" as a quiet text button, for the setup and dead-end screens. */
export function SignOutLink({ label = "Sign out" }: { label?: string }) {
  return (
    <form action={signOut}>
      <button type="submit" className="text-[12.5px] text-mist hover:text-ink">
        {label}
      </button>
    </form>
  );
}
