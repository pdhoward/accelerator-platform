import clsx from "clsx";
import type { ReactNode } from "react";

/** Shared presentational pieces. Server-safe (no hooks). */

export const cx = clsx;

export const btn = {
  base: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  plain: "border-line-2 bg-panel text-ink hover:border-fog",
  gold: "border-gold bg-gold font-semibold text-on-gold hover:bg-gold-2",
  ghost: "border-transparent bg-transparent text-fog hover:bg-panel-2 hover:text-ink",
};

export const button = (variant: keyof Omit<typeof btn, "base"> = "plain", extra?: string) => cx(btn.base, btn[variant], extra);

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-bg/85 px-6 py-3.5 backdrop-blur-md lg:px-8">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-[13px] text-mist">{sub}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="flex w-full max-w-[1320px] flex-col gap-5 px-6 pb-16 pt-6 lg:px-8">{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-line bg-panel", className)}>{children}</section>;
}

export function CardHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <span className="text-[12.5px] text-mist">{hint}</span>}
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("px-5 pb-5 pt-3.5", className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[10.5px] uppercase tracking-[0.14em] text-mist", className)}>{children}</span>;
}

export type Tone = "default" | "good" | "warn" | "bad" | "violet" | "cyan" | "gold";

const TONE: Record<Tone, string> = {
  default: "border-line text-fog",
  good: "border-transparent bg-good/12 text-good",
  warn: "border-transparent bg-warn/12 text-warn",
  bad: "border-transparent bg-bad/12 text-bad",
  violet: "border-transparent bg-violet/15 text-violet",
  cyan: "border-transparent bg-cyan/12 text-cyan",
  gold: "border-gold/45 bg-gold/10 text-gold-2",
};

export function Chip({ children, tone = "default", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function Bar({ value, tone = "brand" }: { value: number; tone?: "brand" | "good" | "warn" | "bad" }) {
  const fill =
    tone === "brand" ? "bg-gradient-to-r from-violet to-cyan" : tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : "bg-bad";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i className={cx("block h-full rounded-full", fill)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function scoreTone(n: number | null): "good" | "warn" | "bad" {
  if (n === null) return "warn";
  return n >= 90 ? "good" : n >= 50 ? "warn" : "bad";
}

/** Lighthouse-style score ring. */
export function ScoreRing({ score, label, size = 72 }: { score: number | null; label: string; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  const color = tone === "good" ? "var(--color-good)" : tone === "warn" ? "var(--color-warn)" : "var(--color-bad)";
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${score ?? "not run"}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${((score ?? 0) / 100) * c} ${c}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="52" textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="28" fontWeight="600" fontFamily="var(--font-mono)">
          {score ?? "—"}
        </text>
      </svg>
      <span className="text-xs text-fog">{label}</span>
    </div>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cx("h-7 w-full", className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--color-cyan)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2" fill="var(--color-cyan)" />
    </svg>
  );
}

export const STAGE_DOT: Record<string, string> = {
  new: "bg-mist",
  clarify: "bg-warn",
  build: "bg-violet",
  prove: "bg-violet",
  try: "bg-cyan",
  ship: "bg-good",
  watch: "bg-good",
  done: "bg-mist",
};
