"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CAPABILITY_FORM, type CapabilitiesResponse, type Capability, type FormValues } from "@accelerator/domain";
import { CheckCircle2, CircleDashed, Plus, Radar, TriangleAlert } from "lucide-react";

import { browserApi } from "@/lib/browser-api";
import { DocDrawer } from "./cockpit/work-sidebar";
import { FormRenderer } from "./form-renderer";
import { button, Card, CardBody, CardHead, Chip, cx, type Tone } from "./ui";
import { useUi } from "./ui-provider";

/**
 * The Site screen's capability inventory (gen2-crew.md §10.3, G2.3a): what
 * the site does for the business, each capability's operational condition
 * (from evidence) and its change progress (per Work item), never merged
 * into one status. Proposals wait for a person.
 */

const CONDITION: Record<Capability["condition"]["state"], { label: string; tone: Tone; Icon: typeof CheckCircle2 }> = {
  verified: { label: "Verified", tone: "good", Icon: CheckCircle2 },
  attention: { label: "Needs attention", tone: "bad", Icon: TriangleAlert },
  unverified: { label: "Unverified", tone: "default", Icon: CircleDashed },
};

export function SiteInventory({ siteId, initial, canManage }: { siteId: string; initial: CapabilitiesResponse; canManage: boolean }) {
  const [inv, setInv] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Capability | "new" | null>(null);
  const [retiring, setRetiring] = useState<Capability | null>(null);
  const [reason, setReason] = useState("");
  const { toast } = useUi();
  const api = browserApi();

  const reload = async () => setInv(await api.capabilities.get(siteId));
  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast(done);
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const proposed = inv.capabilities.filter((c) => c.lifecycle === "proposed");
  const accepted = inv.capabilities.filter((c) => c.lifecycle === "accepted");
  const retired = inv.capabilities.filter((c) => c.lifecycle === "retired");
  const areas = useMemo(() => [...new Set(accepted.map((c) => c.area))].sort(), [accepted]);
  const s = inv.scorecard;

  return (
    <>
      <Card>
        <CardHead title="Inventory scorecard" hint="Counts of different things; they don't add up to one score">
          {canManage && (
            <div className="flex gap-2">
              <button type="button" className={button("plain")} disabled={busy} onClick={() => act(() => api.capabilities.survey(siteId), "The Surveyor read the repository. New findings arrive as proposals.")}>
                <Radar className="size-4" /> Survey the code
              </button>
              <button type="button" className={button("ghost")} disabled={busy} onClick={() => setEditing("new")}>
                <Plus className="size-4" /> Add
              </button>
            </div>
          )}
        </CardHead>
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-scorecard>
          <Stat label="Accepted" value={s.accepted} sub={`${s.proposed} proposed`} />
          <Stat label="Verified" value={s.verified} sub={`of ${s.accepted} accepted`} tone="good" />
          <Stat label="Needs attention" value={s.attention} sub={s.criticalAttention ? `${s.criticalAttention} critical` : "none critical"} tone={s.attention ? "bad" : undefined} />
          <Stat label="Work in the pipeline" value={s.pipeline} sub="open items, each counted once" />
        </CardBody>
      </Card>

      {inv.journeys.map((j) => (
        <Card key={j.name}>
          <CardHead title={`Critical journey: ${j.name}`} hint="From the domain pack; a missing step isn't in the inventory yet" />
          <CardBody>
            <ol className="flex flex-wrap items-center gap-2" aria-label={`${j.name} journey`}>
              {j.steps.map((st, i) => (
                <li key={st.key} className="flex items-center gap-2">
                  <Chip tone={st.present ? "cyan" : "default"} className={cx(!st.present && "border-dashed opacity-70")}>{st.name}</Chip>
                  {i < j.steps.length - 1 && <span aria-hidden className="text-mist">→</span>}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ))}

      {proposed.length > 0 && (
        <Card>
          <CardHead title={`Proposed (${proposed.length})`} hint="The Surveyor's findings. Nothing joins the inventory until a person accepts it." />
          <CardBody className="grid gap-3 md:grid-cols-2" data-proposed>
            {proposed.map((c) => (
              <article key={c.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-line-2 bg-panel-2 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[13.5px] font-semibold">{c.name}</h3>
                    <span className="text-[11.5px] text-mist">{c.area} · confidence {c.confidence != null ? Math.round(c.confidence * 100) : "?"}%</span>
                  </div>
                  <Chip>{c.importance}</Chip>
                </div>
                <p className="text-[12.5px] text-fog">{c.purpose}</p>
                <p className="text-[11.5px] text-mist">{String(c.evidence.basis ?? "")}</p>
                <Paths paths={c.paths} />
                {canManage && (
                  <div className="mt-1 flex gap-2">
                    <button type="button" className={button("gold", "py-1")} disabled={busy} onClick={() => act(() => api.capabilities.review(siteId, c.id, { action: "accept" }), `${c.name} accepted into the inventory.`)}>Accept</button>
                    <button type="button" className={button("ghost", "py-1")} disabled={busy} onClick={() => setEditing(c)}>Edit</button>
                    <button type="button" className={button("ghost", "py-1")} disabled={busy} onClick={() => { setReason("Not a capability of this site."); setRetiring(c); }}>Not this</button>
                  </div>
                )}
              </article>
            ))}
          </CardBody>
        </Card>
      )}

      {accepted.length === 0 && proposed.length === 0 && (
        <Card>
          <CardBody className="pt-5 text-[13.5px] text-fog">
            No capabilities yet. {canManage ? "Survey the code to get the Surveyor's proposals, or add one by hand." : "An Owner or Operator surveys the code to start the inventory."}
          </CardBody>
        </Card>
      )}

      {areas.map((area) => (
        <Card key={area}>
          <CardHead title={area} />
          <CardBody className="flex flex-col divide-y divide-line pt-1" data-area={area}>
            {accepted.filter((c) => c.area === area).map((c) => {
              const cond = CONDITION[c.condition.state];
              return (
                <article key={c.id} className="grid gap-3 py-3.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]" data-capability={c.key}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13.5px] font-semibold">{c.name}</h3>
                      {c.importance === "critical" && <Chip tone="gold">critical</Chip>}
                      {c.requirements.length > 0 && <span className="font-mono text-[11px] text-mist">req v{c.version}</span>}
                    </div>
                    <p className="mt-1 text-[12.5px] text-fog">{c.purpose}</p>
                    {c.requirements.length > 0 && (
                      <ul className="mt-1.5 list-disc pl-4 text-[12px] text-fog">
                        {c.requirements.map((r) => <li key={r.text}>{r.text}{r.acceptance && <span className="text-mist"> — {r.acceptance}</span>}</li>)}
                      </ul>
                    )}
                    <Paths paths={c.paths} />
                  </div>
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-mist">Condition</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Chip tone={cond.tone}><cond.Icon className="size-3" /> {cond.label}</Chip>
                    </div>
                    <p className="mt-1 text-[11.5px] text-mist">{c.condition.reason}{c.condition.ageDays != null ? ` (${c.condition.ageDays}d ago)` : ""}</p>
                    <p className="text-[11.5px] text-mist">{c.tests.length} test file{c.tests.length === 1 ? "" : "s"} cover it</p>
                  </div>
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-mist">Change progress</span>
                    {c.progress.length ? (
                      <ul className="mt-1 flex flex-col gap-1">
                        {c.progress.slice(0, 4).map((p) => (
                          <li key={p.number}>
                            <Link href={`/s/${siteId}/work/${p.number}`} className="text-[12.5px] text-fog hover:text-ink">
                              #{p.number} {p.title} <span className="text-mist">· {p.phase}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[12px] text-mist">No changes in flight.</p>
                    )}
                    {canManage && (
                      <div className="mt-2 flex gap-1.5">
                        <button type="button" className={button("ghost", "px-2 py-1 text-[12px]")} disabled={busy} onClick={() => setEditing(c)}>Edit</button>
                        <button type="button" className={button("ghost", "px-2 py-1 text-[12px]")} disabled={busy} onClick={() => { setReason(""); setRetiring(c); }}>Retire</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </CardBody>
        </Card>
      ))}

      {retired.length > 0 && (
        <details className="rounded-2xl border border-line bg-panel px-5 py-3 text-[13px] text-fog">
          <summary className="cursor-pointer text-mist">Retired ({retired.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {retired.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                {c.name}
                {canManage && (
                  <button type="button" className={button("ghost", "px-2 py-0.5 text-[12px]")} disabled={busy} onClick={() => act(() => api.capabilities.review(siteId, c.id, { action: "restore" }), `${c.name} restored.`)}>Restore</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {editing && (
        <DocDrawer title={editing === "new" ? "Add a capability" : `Edit: ${editing.name}`} onClose={() => setEditing(null)}>
          <FormRenderer
            spec={CAPABILITY_FORM}
            initial={editing === "new" ? { importance: "standard" } : toValues(editing)}
            onCancel={() => setEditing(null)}
            onSubmit={async (values) => {
              const target = editing;
              await act(
                () => (target === "new" ? api.capabilities.add(siteId, values) : api.capabilities.review(siteId, target.id, { action: "edit", values })),
                target === "new" ? "Added to the inventory." : "Saved.",
              );
              setEditing(null);
            }}
          />
        </DocDrawer>
      )}

      {retiring && (
        <DocDrawer title={`Retire: ${retiring.name}`} onClose={() => setRetiring(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const target = retiring;
              await act(() => api.capabilities.review(siteId, target.id, { action: "retire", reason }), `${target.name} retired. The record keeps the reason.`);
              setRetiring(null);
            }}
          >
            <label className="flex flex-col gap-1.5 text-[12.5px] text-fog">
              Why it&apos;s retired (kept on the record)
              <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} className="w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13.5px] text-ink" />
            </label>
            <div className="flex gap-2">
              <button type="submit" className={button("gold")} disabled={busy || !reason.trim()}>Retire it</button>
              <button type="button" className={button("ghost")} onClick={() => setRetiring(null)}>Cancel</button>
            </div>
          </form>
        </DocDrawer>
      )}
    </>
  );
}

const toValues = (c: Capability): FormValues => ({
  name: c.name, area: c.area, purpose: c.purpose, importance: c.importance, paths: c.paths,
  requirements: c.requirements.map((r) => (r.acceptance ? `${r.text} — ${r.acceptance}` : r.text)),
});

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 p-3">
      <div className="text-[11.5px] text-mist">{label}</div>
      <div className={cx("text-2xl font-semibold tabular-nums", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</div>
      <div className="text-[11.5px] text-mist">{sub}</div>
    </div>
  );
}

function Paths({ paths }: { paths: string[] }) {
  if (!paths.length) return null;
  return (
    <details className="text-[11.5px] text-mist">
      <summary className="cursor-pointer">{paths.length} linked file{paths.length === 1 ? "" : "s"}</summary>
      <ul className="mt-1 flex flex-col gap-0.5 font-mono">
        {paths.slice(0, 30).map((p) => <li key={p} className="truncate">{p}</li>)}
      </ul>
    </details>
  );
}
