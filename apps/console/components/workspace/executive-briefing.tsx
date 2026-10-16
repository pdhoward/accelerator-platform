"use client";
import { timestamp } from "@/lib/format";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  CircleHelp,
} from "lucide-react";
import {
  WORK_TERMINAL_LABEL,
  RAIL_LABEL,
  type BriefingResponse,
} from "@accelerator/domain";
import { browserApi } from "@/lib/browser-api";
import { button, Card, Chip, Eyebrow, Page, PageHeader } from "../ui";

/** Executive view of recorded Work progress and review points, with explicit unknowns. */
export function ExecutiveBriefing({
  siteId,
  initial,
  canCreate,
}: {
  siteId: string;
  initial: BriefingResponse;
  canCreate: boolean;
}) {
  const [b, setB] = useState(initial);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    try {
      setB(await browserApi().briefing(siteId));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (initial.source === "sample") return;
    let alive = true;
    const t = setInterval(() => {
      if (document.hidden) return;
      void browserApi()
        .briefing(siteId)
        .then((data) => {
          if (alive) {
            setB(data);
            setError(false);
          }
        })
        .catch(() => {
          if (alive) setError(true);
        });
    }, 12000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [siteId, initial.source]);
  const base = `/s/${encodeURIComponent(siteId)}`;
  const first = b.decisions[0];
  const latest = b.items.find(
    (w) => w.kind === "change" && w.stage !== "cancelled",
  );
  return (
    <>
      <PageHeader
        title="Executive Briefing"
        sub={`${b.siteName} · intent, progress and proof`}
      >
        <button
          type="button"
          className={button("ghost")}
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh briefing"
        >
          <RefreshCw
            className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
          />{" "}
          Refresh
        </button>
        {canCreate && b.source !== "sample" && (
          <Link href={`${base}/work`} className={button("gold")}>
            Propose an improvement <ArrowUpRight className="size-4" />
          </Link>
        )}
      </PageHeader>
      <Page>
        {b.source === "sample" && (
          <p
            className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-sm text-warn"
            role="status"
          >
            Illustrative workspace · synthetic records, sample models and
            checks. No agents are running and no site was changed.
          </p>
        )}
        {error && (
          <p role="alert" className="text-warn">
            Refresh failed. Showing the last received records; current state is
            unknown. Retry Refresh.
          </p>
        )}
        <section className="relative overflow-hidden rounded-3xl border border-violet/35 bg-gradient-to-br from-violet/15 via-panel to-cyan/5 p-6 sm:p-8">
          <div
            className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-violet/20"
            aria-hidden
          />
          <div className="relative max-w-3xl">
            <Eyebrow>
              <span className="inline-flex items-center gap-2">
                <Sparkles className="size-4 text-gold-2" /> Your next move
              </span>
            </Eyebrow>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              {first
                ? "Your expertise moves the work forward."
                : b.active
                  ? "The work is moving. Stay in command."
                  : "What should your site do better?"}
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-fog">
              {first
                ? `${first.detail}. Open the Delivery Studio to inspect the recommendation, candidate and evidence before deciding.`
                : b.active
                  ? `${b.active} active improvement${b.active === 1 ? "" : "s"}. Inspect progress and proof in the Delivery Studio; operational health remains a separate question.`
                  : "Start with a business outcome. Your crew will help shape the requirement, protect what works and show the evidence."}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {latest && (
                <Link
                  href={`${base}/work/${first?.number ?? latest.number}`}
                  className={button("gold", "px-5 py-2.5")}
                >
                  {first ? first.title : "Enter Delivery Studio"}
                  <ArrowRight className="size-4" />
                </Link>
              )}
              <Link
                href={`${base}/work`}
                className={button("plain", "px-5 py-2.5")}
              >
                View all work
              </Link>
            </div>
            <p className="mt-5 text-xs text-mist">
              Record-derived briefing · last received {timestamp(b.observedAt)}{" "}
              · not a generated advisor conversation
            </p>
          </div>
        </section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "Active improvements",
              b.active,
              "Open change records; installations excluded",
            ],
            [
              "Review points",
              b.decisions.length,
              "Review the artifact; server policy decides authority",
            ],
            [
              "Recorded releases",
              b.delivered,
              "Successful release records; not verified business gains",
            ],
            [
              "Protected changes",
              b.protected,
              "Active money, data, authentication or security scope",
            ],
          ].map(([label, value, note]) => (
            <Card key={label} className="p-5">
              <Eyebrow>{label}</Eyebrow>
              <p className="my-3 text-4xl font-semibold tabular-nums">
                {value}
              </p>
              <p className="text-xs leading-relaxed text-fog">{note}</p>
            </Card>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Your improvement portfolio</h2>
              <Chip>{b.items.length} work records</Chip>
            </div>
            <div className="divide-y divide-line">
              {b.items.length === 0 && (
                <p className="py-5 text-fog">
                  No work records yet. Begin with the outcome you want.
                </p>
              )}
              {b.items.map((w) => (
                <Link
                  key={w.id}
                  href={`${base}/work/${w.number}`}
                  className="group flex items-start gap-3 py-4"
                >
                  <span className="mt-0.5 font-mono text-xs text-mist">
                    #{w.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium group-hover:text-cyan">
                      {w.title}
                    </h3>
                    <p className="mt-1 text-xs text-fog">
                      {w.kind === "install"
                        ? "Installation"
                        : "Business improvement"}{" "}
                      ·{" "}
                      {w.risk.length
                        ? `${w.risk.join(", ")} scope`
                        : "No protected risk recorded"}
                    </p>
                  </div>
                  <Chip
                    tone={
                      w.stage === "cancelled"
                        ? "warn"
                        : w.released
                          ? "good"
                          : "violet"
                    }
                  >
                    {w.stage in RAIL_LABEL
                      ? RAIL_LABEL[w.stage as keyof typeof RAIL_LABEL]
                      : (WORK_TERMINAL_LABEL[
                          w.stage as keyof typeof WORK_TERMINAL_LABEL
                        ] ?? w.stage)}
                  </Chip>
                  <ArrowUpRight className="mt-1 size-4 shrink-0 text-mist" />
                </Link>
              ))}
            </div>
          </Card>
          <div className="flex flex-col gap-5">
            <Card className="p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="size-4 text-cyan" /> Protect what works
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-fog">
                Every improvement keeps its design, implementation steps and
                candidate checks together. Release authority stays with the
                existing server-enforced gates.
              </p>
              <p className="mt-3 text-xs text-mist">
                {b.cancelled} closed-without-release work records are excluded
                from delivery counts.
              </p>
            </Card>
            <Card className="p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <CircleHelp className="size-4 text-warn" /> What we cannot yet
                establish
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-4 text-sm text-fog">
                <li>Live customer-journey health and strategic KPI outcomes</li>
                <li>Accepted capability inventory and coverage</li>
                <li>
                  Current budget, token consumption and remaining exposure
                </li>
              </ul>
              <p className="mt-3 text-xs text-mist">
                These measures are unavailable in this slice, rather than
                displayed as invented scores.
              </p>
            </Card>
          </div>
        </div>
      </Page>
    </>
  );
}
