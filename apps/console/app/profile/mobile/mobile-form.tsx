"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { fieldClass } from "@/components/auth-shell";
import { CodeStep } from "@/components/code-step";
import { button } from "@/components/ui";

import { startMobile, verifyMobile } from "../../login/actions";

const CONSENT =
  "I agree to receive sign-in codes and account alerts by text from Strategic Machines. Message and data rates may apply. Reply STOP to opt out.";

/** Number (+ consent) → texted code → verified. */
export function MobileForm({ current }: { current: string | null }) {
  const [mobile, setMobile] = useState("");
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState<{ masked?: string; suppressed?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await startMobile(mobile, CONSENT);
    setBusy(false);
    if (!res.ok) return setError(res.message ?? "Couldn't send a code.");
    setSent({ masked: res.masked, suppressed: res.suppressed });
  }

  async function verify(code: string) {
    const res = await verifyMobile(code);
    if (!res.ok) return res.message ?? "That code isn't right.";
    router.replace("/");
    router.refresh();
    return null;
  }

  if (sent)
    return (
      <CodeStep
        masked={sent.masked}
        suppressed={sent.suppressed}
        onVerify={verify}
        onResend={sent.suppressed ? undefined : () => send()}
        onBack={() => setSent(null)}
      />
    );

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      {current && <p className="text-[13px] text-warn">{current} isn&apos;t verified yet. Enter it again to get a new code.</p>}
      <label htmlFor="mobile" className="text-[12.5px] text-fog">
        Mobile number
      </label>
      <input
        id="mobile"
        type="tel"
        autoComplete="tel"
        autoFocus
        value={mobile}
        onChange={(e) => setMobile(e.target.value)}
        placeholder="+1 914 555 0100"
        className={fieldClass}
      />
      <span className="-mt-1 text-[12px] text-mist">Outside the US, start with + and your country code (e.g. +44 7700 900123).</span>
      <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-snug text-fog">
        <input type="checkbox" className="mt-0.5 accent-violet" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {CONSENT}
      </label>
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
      <button type="submit" className={button("gold", "py-2.5")} disabled={busy || !consent || mobile.replace(/\D/g, "").length < 7}>
        {busy ? "Texting…" : "Text me a code"}
      </button>
    </form>
  );
}
