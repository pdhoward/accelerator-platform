"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  CreditCard,
  Database,
  FileCode2,
  FlaskConical,
  HeartPulse,
  History,
  ListTodo,
  MessagesSquare,
  Puzzle,
  Settings2,
  SplitSquareHorizontal,
  BarChart3,
} from "lucide-react";
import type { Site } from "@accelerator/domain";

import { cx } from "./ui";
import { useUi } from "./ui-provider";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number; engineer?: boolean };
type Group = { title?: string; items: Item[] };

export function Sidebar({ site, userLabel, counts }: { site: Site; userLabel: string; counts: { requests: number; needsYou: number } }) {
  const pathname = usePathname();
  const { engineer, setEngineer, toast } = useUi();
  const base = `/s/${site.slug}`;

  const groups: Group[] = [
    {
      items: [
        { href: base, label: "Bridge", icon: Activity, badge: counts.needsYou },
        { href: `${base}/requests`, label: "Requests", icon: ListTodo, badge: counts.requests },
        { href: `${base}/change`, label: "Change Room", icon: SplitSquareHorizontal },
        { href: `${base}/consult`, label: "Consultations", icon: MessagesSquare },
      ],
    },
    {
      title: "Know",
      items: [
        { href: `${base}/proof`, label: "Proof", icon: FlaskConical },
        { href: `${base}/data`, label: "Data Desk", icon: Database },
        { href: `${base}/library`, label: "Library", icon: BookOpen },
        { href: `${base}/health`, label: "Health", icon: HeartPulse },
        { href: `${base}/releases`, label: "Releases", icon: History },
        { href: `${base}/metrics`, label: "Metrics", icon: BarChart3 },
      ],
    },
    {
      title: "Set up",
      items: [
        { href: `${base}/config`, label: "Configuration", icon: Settings2 },
        { href: `${base}/skills`, label: "Skills", icon: Puzzle },
        { href: `${base}/account`, label: "Account & usage", icon: CreditCard },
        { href: `${base}/code`, label: "Code", icon: FileCode2, engineer: true },
      ],
    },
  ];

  const isActive = (href: string) => (href === base ? pathname === base : pathname.startsWith(href));

  return (
    <aside className="flex flex-col gap-4 border-b border-line bg-panel px-3.5 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-[236px] lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2.5 px-1.5">
        <div className="grid size-7 place-items-center rounded-lg bg-[conic-gradient(from_210deg,var(--color-violet),var(--color-cyan),var(--color-violet))] text-xs font-bold text-white" aria-hidden>
          A
        </div>
        <div className="leading-tight">
          <div className="font-semibold tracking-tight">Control Room</div>
          <div className="text-[11px] text-mist">The Accelerator</div>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-panel-2 px-3 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist">Site</span>
        <span className="flex items-center gap-2 font-semibold">
          <span className="size-2 rounded-full bg-good shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-good)_20%,transparent)]" aria-hidden />
          {site.url.replace(/^https?:\/\//, "")}
        </span>
        <span className="text-xs text-mist">{site.status === "live" ? "Live" : "Onboarding"} · {site.stack}</span>
      </div>

      <nav className="flex gap-4 overflow-x-auto lg:flex-col lg:gap-3 lg:overflow-visible" aria-label="Control Room">
        {groups.map((g, i) => (
          <div key={i} className="flex gap-0.5 lg:flex-col">
            {g.title && <span className="hidden px-2.5 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mist lg:block">{g.title}</span>}
            {g.items
              .filter((it) => !it.engineer || engineer)
              .map((it) => {
                const Icon = it.icon;
                const active = isActive(it.href);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors",
                      active ? "bg-violet/15 text-ink" : "text-fog hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {it.label}
                    {!!it.badge && (
                      <span className="ml-auto rounded-full bg-gold px-1.5 font-mono text-[10.5px] font-semibold text-on-gold">{it.badge}</span>
                    )}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="mt-auto hidden flex-col gap-2.5 lg:flex">
        <button
          type="button"
          aria-pressed={engineer}
          onClick={() => {
            setEngineer(!engineer);
            toast(engineer ? "Engineer view off." : "Engineer view on: code, PRs, files, SQL and model details are shown.");
          }}
          className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-[13px] text-fog hover:border-line-2"
        >
          Engineer view
          <span className={cx("relative h-5 w-9 rounded-full transition-colors", engineer ? "bg-violet" : "bg-line-2")}>
            <span className={cx("absolute left-0 top-[3px] size-3.5 rounded-full bg-white transition-transform", engineer ? "translate-x-[18px]" : "translate-x-[3px]")} />
          </span>
        </button>
        <span className="px-1 text-xs text-mist">{userLabel}</span>
      </div>
    </aside>
  );
}
