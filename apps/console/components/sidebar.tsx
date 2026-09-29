"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  CreditCard,
  Database,
  FileCode2,
  FlaskConical,
  Gauge,
  HeartPulse,
  History,
  ListTodo,
  LogOut,
  MessagesSquare,
  Puzzle,
  ScrollText,
  Settings2,
  SplitSquareHorizontal,
  Users,
} from "lucide-react";

import { signOut } from "@/app/login/actions";

import { Logo } from "./logo";
import { cx } from "./ui";
import { useUi } from "./ui-provider";

/** Icons by name, so server layouts can describe the nav as plain data. */
const ICONS = {
  activity: Activity,
  chart: BarChart3,
  book: BookOpen,
  building: Building2,
  card: CreditCard,
  database: Database,
  code: FileCode2,
  flask: FlaskConical,
  gauge: Gauge,
  heart: HeartPulse,
  history: History,
  list: ListTodo,
  chat: MessagesSquare,
  puzzle: Puzzle,
  scroll: ScrollText,
  settings: Settings2,
  split: SplitSquareHorizontal,
  users: Users,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; engineer?: boolean; exact?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

/**
 * The one sidebar: Control Room and Platform Admin differ only in the groups
 * they pass (already filtered by role on the server) and the context card.
 */
export function AppSidebar({
  title,
  groups,
  context,
  userLabel,
  links,
  engineerToggle,
  signOutEnabled,
}: {
  title: string;
  groups: NavGroup[];
  context?: ReactNode;
  userLabel: string;
  links?: { href: string; label: string }[];
  engineerToggle?: boolean;
  signOutEnabled?: boolean;
}) {
  const pathname = usePathname();
  const { engineer, setEngineer, toast } = useUi();
  const isActive = (it: NavItem) => (it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`));

  return (
    <aside className="flex flex-col gap-4 border-b border-line bg-panel px-3.5 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-[236px] lg:shrink-0 lg:border-b-0 lg:border-r">
      <Link href="/" className="flex items-center gap-2.5 px-1.5">
        <Logo size={28} />
        <div className="leading-tight">
          <div className="font-semibold tracking-tight">{title}</div>
          <div className="text-[11px] text-mist">The Accelerator</div>
        </div>
      </Link>

      {context}

      <nav className="flex gap-4 overflow-x-auto lg:flex-col lg:gap-3 lg:overflow-visible" aria-label={title}>
        {groups.map((g, i) => (
          <div key={i} className="flex gap-0.5 lg:flex-col">
            {g.title && <span className="hidden px-2.5 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mist lg:block">{g.title}</span>}
            {g.items
              .filter((it) => !it.engineer || engineer)
              .map((it) => {
                const Icon = ICONS[it.icon];
                const active = isActive(it);
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
                    {!!it.badge && <span className="ml-auto rounded-full bg-gold px-1.5 font-mono text-[10.5px] font-semibold text-on-gold">{it.badge}</span>}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="mt-auto hidden flex-col gap-2.5 lg:flex">
        {engineerToggle && (
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
        )}
        {links?.map((l) => (
          <Link key={l.href} href={l.href} className="px-1 text-[12.5px] text-fog hover:text-ink">
            {l.label} →
          </Link>
        ))}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="min-w-0 truncate text-xs text-mist" title={userLabel}>
            {userLabel}
          </span>
          {signOutEnabled && (
            <form action={signOut}>
              <button type="submit" className="rounded-md p-1 text-mist hover:bg-panel-2 hover:text-ink" aria-label="Sign out" title="Sign out">
                <LogOut className="size-3.5" />
              </button>
            </form>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Small labelled card under the brand: the site, or the admin area. */
export function SidebarContext({ eyebrow, title, sub, dot }: { eyebrow: string; title: string; sub?: string; dot?: "good" | "warn" | "violet" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-panel-2 px-3 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist">{eyebrow}</span>
      <span className="flex items-center gap-2 font-semibold">
        {dot && <span className={cx("size-2 rounded-full", dot === "good" ? "bg-good" : dot === "warn" ? "bg-warn" : "bg-violet")} aria-hidden />}
        <span className="truncate">{title}</span>
      </span>
      {sub && <span className="text-xs text-mist">{sub}</span>}
    </div>
  );
}
