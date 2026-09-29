"use client";

import { useState } from "react";

import { fieldClass } from "./auth-shell";
import { button } from "./ui";

/**
 * "We texted a code to •••• 5391" → enter it. Shared by sign-in and the
 * mobile-number step. Accepts 6-digit codes and longer reserve codes.
 */
export function CodeStep({
  masked,
  reserve,
  onVerify,
  onResend,
  onBack,
}: {
  masked?: string;
  reserve?: boolean;
  onVerify: (code: string) => Promise<string | null>;
  onResend?: () => Promise<void>;
  onBack?: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await onVerify(code.trim()));
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-[13.5px] text-fog">
        {reserve ? "Enter your personal reserve code." : `We texted a 6-digit code to ${masked}. It expires in 10 minutes.`}
      </p>
      <label htmlFor="code" className="sr-only">
        Code
      </label>
      <input
        id="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={12}
        placeholder={reserve ? "Reserve code" : "123456"}
        className={`${fieldClass} text-center font-mono text-lg tracking-[0.4em]`}
      />
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
      <button type="submit" className={button("gold", "py-2.5")} disabled={busy || code.trim().length < 4}>
        {busy ? "Checking…" : "Continue"}
      </button>
      <div className="flex justify-between text-[12.5px]">
        {onBack && <button type="button" className="text-mist hover:text-ink" onClick={onBack}>← Back</button>}
        {onResend && <button type="button" className="text-mist hover:text-ink" onClick={() => void onResend()}>Text me a new code</button>}
      </div>
    </form>
  );
}
