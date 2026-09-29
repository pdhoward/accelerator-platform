"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquareText } from "lucide-react";

import { fieldClass } from "@/components/auth-shell";
import { CodeStep } from "@/components/code-step";
import { button } from "@/components/ui";
import { WAITLIST_URL } from "@/lib/links";

import { sendMagicLink, sendSignInCode, verifySignInCode } from "./actions";

type Step = { kind: "email" } | { kind: "link-sent" } | { kind: "code"; masked?: string; reserve?: boolean };

/** Email → "Email me a link" or "Text me a code" → (code) → in. */
export function LoginForm({ next, allowReserve }: { next?: string; allowReserve: boolean }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [busy, setBusy] = useState<"link" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOnly, setInviteOnly] = useState(false);
  const router = useRouter();
  const valid = /^\S+@\S+\.\S+$/.test(email);

  async function run(kind: "link" | "code") {
    setBusy(kind);
    setError(null);
    setInviteOnly(false);
    const res = kind === "link" ? await sendMagicLink(email, next) : await sendSignInCode(email);
    setBusy(null);
    if (res.inviteOnly) return setInviteOnly(true);
    if (!res.ok) return setError(res.message ?? "Couldn't continue.");
    setStep(kind === "link" ? { kind: "link-sent" } : { kind: "code", masked: res.masked });
  }

  async function verify(code: string) {
    const res = await verifySignInCode(email, code);
    if (!res.ok) return res.message ?? "That code isn't right.";
    router.replace(next ?? "/");
    router.refresh();
    return null;
  }

  if (step.kind === "link-sent") {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-good/30 bg-good/10 p-5">
        <p className="font-medium">Check your inbox</p>
        <p className="text-[13.5px] text-fog">We sent a sign-in link to {email}. Open it on this device.</p>
        <button type="button" className="self-start text-[12.5px] text-mist hover:text-ink" onClick={() => setStep({ kind: "email" })}>
          ← Use a different method
        </button>
      </div>
    );
  }

  if (step.kind === "code") {
    return (
      <CodeStep
        masked={step.masked}
        reserve={step.reserve}
        onVerify={verify}
        onResend={step.reserve ? undefined : () => run("code")}
        onBack={() => setStep({ kind: "email" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="email" className="text-[12.5px] text-fog">
        Work email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className={fieldClass}
      />
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
      {inviteOnly && (
        <div className="rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-3 text-[13px] text-fog" role="alert">
          <p className="font-medium text-ink">The Control Room is invite-only for now.</p>
          <p className="mt-1">
            Join the waitlist and we&apos;ll be in touch.{" "}
            <a href={WAITLIST_URL} className="font-medium text-gold-2 underline underline-offset-4">
              Join the waitlist →
            </a>
          </p>
        </div>
      )}
      <button type="button" className={button("gold", "py-2.5")} disabled={!valid || !!busy} onClick={() => run("link")}>
        <Mail className="size-4" /> {busy === "link" ? "Sending…" : "Email me a sign-in link"}
      </button>
      <button type="button" className={button("plain", "py-2.5")} disabled={!valid || !!busy} onClick={() => run("code")}>
        <MessageSquareText className="size-4" /> {busy === "code" ? "Texting…" : "Text me a code"}
      </button>
      {allowReserve && (
        <button
          type="button"
          className="self-center pt-1 text-[12.5px] text-mist hover:text-ink disabled:opacity-40"
          disabled={!valid}
          onClick={() => setStep({ kind: "code", reserve: true })}
        >
          Use reserve code (development only)
        </button>
      )}
    </div>
  );
}
