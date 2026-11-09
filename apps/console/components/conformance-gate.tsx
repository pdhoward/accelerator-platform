"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { caseLabel, type Scenario } from "@accelerator/domain";
import type { Compliance } from "@accelerator/api-client";

import { browserApi } from "@/lib/browser-api";
import { button, Card, CardBody, CardHead, Chip } from "./ui";

/**
 * The conformance gate (gen3-cradle.md §4, B5): test-driven policy for an
 * AI-run app. The app proves every new version of the book against these
 * scenarios before it serves it; the last version that passed stays in force.
 */
export function ConformanceGate({ siteId, canManage }: { siteId: string; canManage: boolean }) {
  const api = browserApi();
  const [c, setC] = useState<Compliance | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => void api.cradle.compliance(siteId).then(setC).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  if (!c) return null;
  const live = c.scenarios.filter((s) => s.status !== "retired");
  const results = new Map((c.proof?.results ?? []).map((r) => [r.id, r]));
  const held = !!c.live && c.inForce?.version !== c.live;
  const failing = live.filter((s) => results.get(s.id) && !results.get(s.id)!.passed);
  const drafts = live.filter((s) => s.status === "draft").length;
  const set = (id: string, status: Scenario["status"]) => {
    setBusy(true);
    api.cradle.scenario(siteId, id, status as "approved").then(setC).finally(() => setBusy(false));
  };

  return (
    <Card>
      <CardHead
        title="Conformance gate"
        hint="Every rule is proven before the app runs on it. When the book changes, the app runs these scenarios against the new version; it switches only when all pass. Until then, the last version that passed stays in force."
      />
      <CardBody className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="In force" value={c.inForce ? c.inForce.version : "none yet"} note={c.inForce ? `proven ${new Date(c.inForce.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "the app runs the live book until its first proof"} />
          <Stat
            label="Newest rules"
            value={c.live ?? "—"}
            note={!held ? "in force" : c.proof?.status === "running" ? "being proven now" : c.proof?.status === "requested" ? "waiting for the app to prove it again" : c.proof?.status === "failed" ? (failing.length ? `held: ${failing.length} failing` : "held: scenarios changed, press Prove again") : "waiting for the app to prove it"}
            tone={held && c.proof?.status === "failed" ? "bad" : held ? "warn" : "good"}
          />
          <Stat label="Scenarios" value={`${c.proof ? `${c.proof.passed}/${c.proof.total}` : live.length}`} note={`${live.length} in the suite${drafts ? ` · ${drafts} drafts to review` : ""}${c.proof ? ` · $${c.proof.costUsd.toFixed(3)} to prove` : ""}`} />
        </div>

        {failing.length > 0 && (
          <div className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[13px]">
            <p className="font-medium text-bad">Held: these cases fail on the newest rules</p>
            <ul className="mt-1 flex flex-col gap-1">
              {failing.map((s) => (
                <li key={s.id}><span className="font-mono text-[11.5px] text-mist">{s.id}</span> {s.title} <span className="text-mist">· {results.get(s.id)!.detail}</span></li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
        {canManage && held && c.proof?.status === "failed" && (
          <button type="button" className={button("gold")} disabled={busy} onClick={() => { setBusy(true); api.cradle.reprove(siteId).then(setC).finally(() => setBusy(false)); }}>
            Prove again
          </button>
        )}
        <button type="button" className={button("ghost")} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the scenarios" : `Show the ${live.length} scenarios`}
        </button>
        <Link href={`/s/${siteId}/policy/proof`} className={button("ghost")}>Scorecard</Link>
        </div>
        {open && (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {c.scenarios.map((s) => {
              const r = results.get(s.id);
              return (
                <li key={s.id} className={`flex flex-wrap items-start gap-2 px-3 py-2.5 ${s.status === "retired" ? "opacity-50" : ""}`}>
                  <span className="w-14 shrink-0 font-mono text-[11.5px] text-mist">{s.id}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{s.title}</p>
                    <p className="text-[12.5px] text-fog">Given {s.given} · when {s.when} · then {s.then}</p>
                    <p className="font-mono text-[11px] text-mist">{s.check.kind} · {s.criticality} · {s.policies.join(", ")}</p>
                  </div>
                  <Chip tone={!r ? "default" : r.passed ? "good" : "bad"}>{caseLabel(r)}</Chip>
                  <Chip tone={s.status === "approved" ? "good" : s.status === "draft" ? "warn" : "default"}>{s.status}</Chip>
                  {canManage && s.status === "draft" && <button type="button" className={button("ghost")} disabled={busy} onClick={() => set(s.id, "approved")}>Approve</button>}
                  {canManage && s.status !== "retired" && <button type="button" className={button("ghost")} disabled={busy} onClick={() => set(s.id, "retired")}>Retire</button>}
                  {canManage && s.status === "retired" && <button type="button" className={button("ghost")} disabled={busy} onClick={() => set(s.id, "draft")}>Restore</button>}
                </li>
              );
            })}
            {!c.scenarios.length && <li className="px-3 py-3 text-[13px] text-mist">No scenarios yet. The app drafts them from the book the first time it proves a version.</li>}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink";
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</div>
      <div className={`font-mono text-[15px] ${color}`}>{value}</div>
      <div className="text-[12px] text-mist">{note}</div>
    </div>
  );
}
