"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UsageMeter } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";
import { button } from "./ui";
import { useUi } from "./ui-provider";

/** Spend limits per model plus a daily cap. The runner refuses work past either. */
export function LimitsForm({ siteId, meters, dailyCapUsd }: { siteId: string; meters: UsageMeter[]; dailyCapUsd: number }) {
  const [cap, setCap] = useState(String(dailyCapUsd));
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries(meters.map((m) => [m.model, String(m.limitUsd)])));
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await browserApi().account.setLimits(siteId, {
        dailyCapUsd: Number(cap),
        limits: Object.entries(limits).map(([model, v]) => ({ model, limitUsd: Number(v) })),
      });
      toast("Limits saved. The engine pauses and tells you before it would go past any of them.");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save limits.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-24 rounded-lg border border-line-2 bg-panel-2 px-2.5 py-1.5 text-right font-mono text-[12.5px] tabular-nums text-ink focus:border-violet focus:outline-none";

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel-2 px-3.5 py-2.5">
        <label htmlFor="daily-cap" className="text-[13px]">
          Daily cap, all models
        </label>
        <span className="flex items-center gap-1.5 text-mist">
          $<input id="daily-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className={input} />
        </span>
      </div>
      {meters.map((m) => (
        <div key={m.model} className="flex flex-wrap items-center justify-between gap-3 px-1">
          <label htmlFor={`limit-${m.model}`} className="text-[13px]">
            {m.model} <span className="text-mist">· {m.role}</span>
          </label>
          <span className="flex items-center gap-1.5 text-mist">
            $
            <input
              id={`limit-${m.model}`}
              inputMode="decimal"
              value={limits[m.model] ?? ""}
              onChange={(e) => setLimits((l) => ({ ...l, [m.model]: e.target.value }))}
              className={input}
            />
            / month
          </span>
        </div>
      ))}
      <button type="submit" className={button("gold", "self-start")} disabled={busy}>
        {busy ? "Saving…" : "Save limits"}
      </button>
    </form>
  );
}
