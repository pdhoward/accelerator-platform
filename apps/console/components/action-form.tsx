"use client";

import { useActionState, type ReactNode } from "react";

import { button } from "./ui";

export type FormState = { ok: boolean; message?: string } | null;

/**
 * Any form backed by a server action: pending state, and the action's
 * success or error message under the button. Used by every admin form.
 */
export function ActionForm({
  action,
  submit,
  pending = "Saving…",
  variant = "gold",
  className,
  children,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submit: string;
  pending?: string;
  variant?: "gold" | "plain";
  className?: string;
  children: ReactNode;
}) {
  const [state, run, busy] = useActionState(action, null);
  return (
    <form action={run} className={className ?? "flex flex-col gap-3"}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={button(variant)} disabled={busy}>
          {busy ? pending : submit}
        </button>
        {state?.message && (
          <span className={state.ok ? "text-[13px] text-good" : "text-[13px] text-bad"} role={state.ok ? "status" : "alert"}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13.5px] text-ink placeholder:text-mist focus:border-violet focus:outline-none";

/** Label + control, stacked. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[12.5px] text-fog">
      {label}
      {children}
      {hint && <span className="text-[11.5px] text-mist">{hint}</span>}
    </label>
  );
}
