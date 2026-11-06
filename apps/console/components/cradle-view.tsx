"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ALIGN_LABEL,
  CRITICALITY_LABEL,
  cradleReadings,
  DOMAIN_PACKS,
  FINDING_LABEL,
  PACKS,
  starterSteps,
  type BookPolicy,
  type CradleResponse,
  type Domain,
  type Finding,
  type ParamValue,
  type Ruling,
} from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";
import { CockpitDial, CONDITION_WORD } from "./cockpit/cockpit-dial";
import { ConformanceGate } from "./conformance-gate";
import { CradleLive } from "./cradle-live";
import { button, Card, CardBody, CardHead, Chip, cx, Eyebrow } from "./ui";
import { useUi } from "./ui-provider";

/**
 * The Policy screen (gen3-cradle.md): the site's app as its policy book. The
 * workbench dial shows the book's vital signs; below it the starter scaffold,
 * the live ingest, the findings to work through (the Policy Walk), and the
 * book itself, where the steward rules.
 */

const CRIT_TONE = { critical: "bad", important: "warn", routine: "default" } as const;
const BINDING_LABEL = { adopted: "pack", overridden: "overridden", site: "site's own" } as const;
const STATUS_TONE = { confirmed: "good", unreviewed: "default", disputed: "warn", retired: "default" } as const;

export function CradleView({ siteId, initial, canManage, siteUrl, defaultPack }: { siteId: string; initial: CradleResponse; canManage: boolean; siteUrl: string | null; defaultPack: Domain | null }) {
  const api = browserApi();
  const { toast } = useUi();
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [dial, setDial] = useState(0);
  const [watch, setWatch] = useState(initial.ingest?.status === "running" || initial.ingest?.status === "queued");
  const running = r.ingest?.status === "running" || r.ingest?.status === "queued";

  // While decisions are on their way into the code, keep their status current.
  const aligning = r.alignments.some((a) => a.work && !a.work.released && a.work.stage !== "done" && a.work.stage !== "cancelled");
  useEffect(() => {
    if (!aligning || running) return;
    const t = setInterval(() => void api.cradle.get(siteId).then(setR).catch(() => {}), 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aligning, running, siteId]);

  // While the crew reads the site, refresh the book until the run lands.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void api.cradle.get(siteId).then(setR).catch(() => {}), 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, siteId]);

  const act = async (fn: () => Promise<CradleResponse>, done?: string) => {
    setBusy(true);
    try {
      setR(await fn());
      if (done) toast(done);
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const rule = (key: string, ruling: Ruling, done: string) => act(() => api.cradle.rule(siteId, key, ruling), done);

  const readings = useMemo(() => cradleReadings(r), [r]);
  const reading = readings[dial] ?? readings[0]!;

  if (!r.cradle) return <Starter defaultPack={defaultPack} canManage={canManage} busy={busy} onStart={(pack) => act(() => api.cradle.start(siteId, pack), "The cradle is set up.")} />;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardBody className="grid items-center gap-6 pt-5 md:grid-cols-[300px_1fr]">
          <CockpitDial readings={readings} index={dial} onIndex={setDial} label="Policy book measures" />
          <div className="min-w-0">
            <Eyebrow>{r.pack?.label} pack {r.cradle.packVersion} · started {new Date(r.cradle.startedAt).toLocaleDateString()}{r.cradle.startedBy ? ` by ${r.cradle.startedBy}` : ""}</Eyebrow>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-4xl font-semibold tabular-nums">{reading.headline ?? "—"}</span>
              <span className="text-lg text-fog">{reading.label}</span>
              <Chip tone={reading.condition === "verified" ? "good" : reading.condition === "attention" ? "warn" : "default"}>{CONDITION_WORD[reading.condition]}</Chip>
            </div>
            <ul className="mt-2 space-y-1 text-[13.5px] text-fog">{reading.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {canManage && (
                <button type="button" className={button(r.cradle.ingestedAt ? "plain" : "gold")} disabled={busy || running} onClick={() => { setWatch(true); void act(() => api.cradle.ingest(siteId), "The crew is reading the site."); }}>
                  {running ? "Reading the site…" : r.cradle.ingestedAt ? "Ingest again" : "Ingest the site"}
                </button>
              )}
              {r.ingest && !watch && <button type="button" className={button("ghost")} onClick={() => setWatch(true)}>Watch the last run</button>}
              {r.readiness?.complete && <Chip tone="good">Policy Walk complete</Chip>}
              {r.sample && canManage && <button type="button" className={button("ghost", "ml-auto")} disabled={busy} onClick={() => act(() => api.cradle.reset(siteId), "Demo reset.")}>Reset demo</button>}
            </div>
            {r.ingest?.summary && <p className="mt-3 text-[13px] text-mist">Last ingest: {r.ingest.summary}</p>}
            {r.ingest?.status === "failed" && <p className="mt-3 text-[13px] text-bad">The last ingest failed: {r.ingest.error}</p>}
          </div>
        </CardBody>
      </Card>

      {watch && r.ingest && (
        <Card>
          <CardHead title={running ? "The crew is reading the site" : "The last ingest"} hint="Read-only. Every policy it finds waits for your ruling.">
            <button type="button" className={button("ghost")} onClick={() => setWatch(false)}>Hide</button>
          </CardHead>
          <CardBody>
            <CradleLive key={r.ingest.jobId} siteId={siteId} jobId={r.ingest.jobId} siteUrl={siteUrl} running={running} book={r.book} conflicts={r.conflicts} concepts={r.pack?.concepts ?? []} onDone={() => void api.cradle.get(siteId).then(setR)} />
          </CardBody>
        </Card>
      )}

      <div id="policy-walk" className="scroll-mt-4">
        <Findings
          r={r}
          canManage={canManage}
          busy={busy}
          onResolve={(id, ruling) => act(() => api.cradle.resolve(siteId, id, ruling), "Ruled. The crew is bringing the code into line.")}
          onRule={rule}
          onFill={(concept, event, statement) => act(() => api.cradle.fill(siteId, concept, event, statement), "Policy added. The crew is checking the code follows it.")}
        />
      </div>
      <Alignments r={r} siteId={siteId} canManage={canManage} busy={busy} onAlign={() => act(() => api.cradle.align(siteId), "Sent to the crew.")} />
      {!r.sample && <ConformanceGate siteId={siteId} canManage={canManage} />}
      {canManage && !r.sample && <RuntimeConnection siteId={siteId} />}
      <Book r={r} canManage={canManage} busy={busy} onRule={rule} />
    </div>
  );
}

/**
 * Run the app on this book (backlog B4): the address and token the site's own
 * app uses to read its rules at runtime. Shown on request, like any key.
 */
function RuntimeConnection({ siteId }: { siteId: string }) {
  const api = browserApi();
  const [conn, setConn] = useState<{ url: string; token: string; env: { url: string; token: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const show = () => api.cradle.runtime(siteId).then(setConn, (e: Error) => setError(e.message));
  const block = conn ? `${conn.env.url}=${conn.url}
${conn.env.token}=${conn.token}` : "";
  return (
    <Card>
      <CardHead title="Run the app on this book" hint="The app agent reads these rules live: a ruling here changes what the app does, with no code change and no release. Add these two settings to the app's own environment (for Machine Shop: Vercel → Settings → Environment Variables)." />
      <CardBody className="flex flex-col gap-2">
        {conn ? (
          <>
            <pre className="overflow-x-auto rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-fog">{block}</pre>
            <div className="flex items-center gap-2">
              <button type="button" className={button("ghost")} onClick={() => void navigator.clipboard.writeText(block).then(() => setCopied(true))}>{copied ? "Copied" : "Copy both"}</button>
              <span className="text-[12px] text-mist">Treat the token like a password. It reads this site's book and nothing else.</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <button type="button" className={button("ghost")} onClick={() => void show()}>Show the connection</button>
            {error && <span className="text-[12.5px] text-bad">{error}</span>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── The starter: like a framework's create command, for a business ──────────

function Starter({ defaultPack, canManage, busy, onStart }: { defaultPack: Domain | null; canManage: boolean; busy: boolean; onStart: (pack: Domain) => void }) {
  const [pack, setPack] = useState<Domain>(defaultPack ?? "commerce");
  const [shown, setShown] = useState(0);
  const steps = starterSteps(PACKS[pack]);
  const [launching, setLaunching] = useState(false);
  useEffect(() => {
    if (!launching) return;
    if (shown >= steps.length) {
      const t = setTimeout(() => onStart(pack), 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((n) => n + 1), 380);
    return () => clearTimeout(t);
  }, [launching, shown, steps.length, onStart, pack]);

  return (
    <Card>
      <CardHead title="Start the cradle" hint="Like a framework's create command, but for your business: an industry's best practices, ready for you to explain how you run yours." />
      <CardBody className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-3">
          <Eyebrow>Industry pack</Eyebrow>
          {(Object.keys(PACKS) as Domain[]).map((d) => (
            <label key={d} className={cx("flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5", pack === d ? "border-gold/60 bg-gold/5" : "border-line")}>
              <input type="radio" name="pack" checked={pack === d} onChange={() => { setPack(d); setShown(0); setLaunching(false); }} className="mt-1" />
              <span>
                <span className="font-medium">{DOMAIN_PACKS[d].label}</span> <span className="font-mono text-[11px] text-mist">{PACKS[d].version}</span>
                <span className="block text-[13px] text-fog">{PACKS[d].summary}</span>
              </span>
            </label>
          ))}
          <p className="text-[12.5px] text-mist">Next, the crew reads your site's code and lays what it finds over the pack: what you already do, what differs, and what's missing.</p>
          {canManage ? (
            <button type="button" className={button("gold", "self-start")} disabled={busy || launching} onClick={() => setLaunching(true)}>Create the cradle</button>
          ) : (
            <p className="text-[13px] text-fog">Ask someone who manages configuration to start it.</p>
          )}
        </div>
        <div className="rounded-xl border border-line bg-[#0b0b0f] p-4 font-mono text-[12.5px] leading-[1.9]">
          <div className="text-fog"><span className="text-good">$</span> npx create-cradle --pack {pack}</div>
          {steps.slice(0, launching ? shown : steps.length).map((s) => (
            <div key={s.label} className={launching ? "" : "opacity-50"}>
              <span className="text-good">✓</span> <span className="text-ink">{s.label}</span> <span className="text-mist">· {s.detail}</span>
            </div>
          ))}
          {launching && shown >= steps.length && <div className="text-gold-2">Ready. Next: ingest the site.</div>}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Findings: what the Policy Walk works through, critical first ────────────

type WalkActions = {
  onResolve: (id: string, ruling: string) => void;
  onRule: (key: string, ruling: Ruling, done: string) => void;
  onFill: (concept: string, event: string, statement: string) => void;
};

/** Which sentence a row is asking for: a ruling, a restatement, a reason to retire, or a policy for a hole. */
type Ask = { mode: "rule" | "restate" | "retire" | "fill"; text: string };
const ASK_PLACEHOLDER: Record<Ask["mode"], string> = {
  rule: "Your ruling, in a sentence. It becomes precedent, and the crew brings the code into line.",
  restate: "What the policy should say instead, in a sentence. The crew changes the code to match.",
  retire: "Why the site should stop doing this. The crew removes it from the code.",
  fill: "The policy, in a sentence (or say it doesn't apply here). The crew checks the code follows it.",
};
const ASK_BUTTON: Record<Ask["mode"], string> = { rule: "Rule", restate: "Change it", retire: "Retire it", fill: "Add the policy" };

function Findings({ r, canManage, busy, onResolve, onRule, onFill }: { r: CradleResponse; canManage: boolean; busy: boolean } & WalkActions) {
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState<Record<string, Ask>>({});
  // Kernels are the crew's build list, not the steward's: they are counted below, not walked.
  const main = r.findings.filter((f) => f.kind !== "no_review_date" && f.kind !== "unproven" && f.kind !== "needs_kernel");
  const kernels = r.findings.filter((f) => f.kind === "needs_kernel");
  const list = all ? main : main.slice(0, 8);
  if (!main.length && !kernels.length) return null;
  const idOf = (f: Finding, i: number) => f.conflictId ?? (f.at ? `${f.at.concept}/${f.at.event}` : f.keys[0] ?? String(i));
  const open = (id: string, mode: Ask["mode"]) => setAsk({ ...ask, [id]: { mode, text: ask[id]?.mode === mode ? ask[id]!.text : "" } });
  const submit = (f: Finding, id: string) => {
    const a = ask[id]!;
    const text = a.text.trim();
    if (a.mode === "rule") onResolve(f.conflictId!, text);
    else if (a.mode === "fill") onFill(f.at!.concept, f.at!.event, text);
    else if (a.mode === "restate") onRule(f.keys[0]!, { action: "restate", statement: text }, "Changed. The crew is aligning the code.");
    else onRule(f.keys[0]!, { action: "retire", reason: text }, "Retired. The crew is taking it out of the code.");
    setAsk(Object.fromEntries(Object.entries(ask).filter(([k]) => k !== id)));
  };
  return (
    <Card>
      <CardHead title="The Policy Walk" hint={`${main.length} to work through, critical first. Confirm what's right, change or retire what isn't, and fill the holes. The crew brings the code into line with every decision.`} />
      <CardBody className="flex flex-col gap-2">
        {list.map((f, i) => {
          const id = idOf(f, i);
          const a = f.kind === "conflict" ? (ask[id] ?? { mode: "rule" as const, text: "" }) : f.kind === "hole" ? (ask[id] ?? { mode: "fill" as const, text: "" }) : ask[id];
          return (
            <div key={`${f.kind}-${id}`} className={cx("rounded-lg border px-3 py-2.5", f.kind === "conflict" ? "border-bad/40 bg-bad/5" : "border-line")} data-finding={f.kind}>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={f.kind === "conflict" ? "bad" : f.kind === "hole" ? "warn" : "default"}>{FINDING_LABEL[f.kind]}</Chip>
                <Chip tone={CRIT_TONE[f.criticality]}>{CRITICALITY_LABEL[f.criticality]}</Chip>
                <span className="min-w-0 flex-1 text-[14px] font-medium">{f.title}</span>
                {canManage && f.kind === "unreviewed" && f.keys[0] && (
                  <span className="flex gap-1.5">
                    <button type="button" className={button("plain")} disabled={busy} onClick={() => onRule(f.keys[0]!, { action: "confirm" }, "Confirmed.")}>Confirm</button>
                    <button type="button" className={button(a?.mode === "restate" ? "gold" : "ghost")} disabled={busy} onClick={() => open(id, "restate")}>Change</button>
                    <button type="button" className={button(a?.mode === "retire" ? "gold" : "ghost")} disabled={busy} onClick={() => open(id, "retire")}>Retire</button>
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-fog">{f.detail}</p>
              {canManage && a && (
                <div className="mt-2 flex gap-2">
                  <input value={a.text} onChange={(e) => setAsk({ ...ask, [id]: { ...a, text: e.target.value } })} placeholder={ASK_PLACEHOLDER[a.mode]} className="min-w-0 flex-1 rounded-lg border border-line-2 bg-panel-2 px-3 py-1.5 text-[13px]" data-ask={a.mode} />
                  <button type="button" className={button("gold")} disabled={busy || !a.text.trim()} onClick={() => submit(f, id)}>{ASK_BUTTON[a.mode]}</button>
                </div>
              )}
            </div>
          );
        })}
        {main.length > 8 && <button type="button" className={button("ghost", "self-start")} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${main.length}`}</button>}
        {kernels.length > 0 && (
          <div className="mt-1 rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] text-fog" data-crew-list>
            <span className="font-medium text-ink">On the crew&rsquo;s build list, not yours:</span> {kernels.length} critical {kernels.length === 1 ? "policy waits" : "policies wait"} for a kernel ({kernels.map((k) => k.title).join("; ")}). A kernel is tested code that enforces a critical policy, so no model can get it wrong. The crew builds it; you approve it before it goes live.
          </div>
        )}
        {r.conflicts.some((c) => c.status === "resolved") && (
          <details className="mt-1 text-[13px] text-fog">
            <summary className="cursor-pointer text-mist">Rulings ({r.conflicts.filter((c) => c.status === "resolved").length})</summary>
            <ul className="mt-2 space-y-1">{r.conflicts.filter((c) => c.status === "resolved").map((c) => <li key={c.id}><span className="font-mono text-[11px] text-mist">{c.keys.join(" × ")}</span> {c.ruling}</li>)}</ul>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

// ── Alignment: each decision on its way into the code (policy → work → proof) ─

const ALIGN_STAGE: Record<string, { label: string; tone: "default" | "warn" | "good" | "violet" }> = {
  discuss: { label: "The lead is reading it", tone: "default" },
  design: { label: "Brief: waiting for you", tone: "warn" },
  plan: { label: "Planning", tone: "violet" },
  build: { label: "Changing the code", tone: "violet" },
  prove: { label: "Proving it", tone: "violet" },
  try: { label: "Preview: waiting for you", tone: "warn" },
  release: { label: "Going live", tone: "violet" },
  learn: { label: "Live", tone: "good" },
  done: { label: "In the code", tone: "good" },
  cancelled: { label: "Closed unfinished", tone: "default" },
};

function Alignments({ r, siteId, canManage, busy, onAlign }: { r: CradleResponse; siteId: string; canManage: boolean; busy: boolean; onAlign: () => void }) {
  const sent = new Set(r.alignments.filter((a) => a.work?.stage !== "cancelled").map((a) => a.conflictId).filter(Boolean));
  const waiting = r.sample ? [] : r.conflicts.filter((c) => c.status === "resolved" && c.ruling && !sent.has(c.id));
  if (!r.alignments.length && !waiting.length) return null;
  return (
    <Card>
      <CardHead title="Aligning the code" hint="Each decision you make goes to the crew. They find the code, change it, and prove it. Anything touching an integration (payments, orders) waits for the Owner's approval before it goes live." />
      <CardBody className="flex flex-col gap-2" data-alignments>
        {waiting.length > 0 && canManage && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gold-2/40 bg-gold-2/5 px-3 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">{waiting.length} {waiting.length === 1 ? "ruling was" : "rulings were"} made before the crew took rulings on. Send {waiting.length === 1 ? "it" : "them"} now.</span>
            <button type="button" className={button("gold")} disabled={busy} onClick={onAlign}>Send to the crew</button>
          </div>
        )}
        {r.alignments.map((a) => {
          const st = a.work?.blocked && a.work.stage !== "done" && a.work.stage !== "cancelled" ? { label: "Blocked: open the Work item", tone: "warn" as const } : a.work ? (a.work.released && a.work.stage !== "done" ? ALIGN_STAGE.learn! : ALIGN_STAGE[a.work.stage] ?? { label: a.work.stage, tone: "default" as const }) : { label: "Recorded (demo: no crew)", tone: "default" as const };
          return (
            <div key={a.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-line px-3 py-2.5" data-alignment={a.decision}>
              <Chip>{ALIGN_LABEL[a.decision]}</Chip>
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">&ldquo;{a.sentence}&rdquo;</p>
                <p className="mt-0.5 text-[12px] text-mist">{a.by} · {new Date(a.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{a.keys.length ? ` · ${a.keys.join(", ")}` : ""}</p>
              </div>
              <Chip tone={st.tone}>{st.label}</Chip>
              {a.work && <a href={`/s/${siteId}/work/${a.work.number}`} className={button("ghost")}>Work #{a.work.number} →</a>}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

// ── The book: every policy in force, by concept ─────────────────────────────

function Book({ r, canManage, busy, onRule }: { r: CradleResponse; canManage: boolean; busy: boolean; onRule: (key: string, ruling: Ruling, done: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = (r.pack?.concepts ?? []).map((c) => ({ c, policies: r.book.filter((p) => p.concept === c.key) }));
  const other = r.book.filter((p) => !r.pack?.concepts.some((c) => c.key === p.concept));
  if (other.length) groups.push({ c: { key: "other", label: "Other", events: [], floor: "routine" }, policies: other });
  return (
    <Card>
      <CardHead title="The policy book" hint={`${r.book.length} policies in force, in controlled English. Each one is versioned, owned and dated; your rulings are the record.`} />
      <CardBody className="flex flex-col gap-5">
        {groups.filter((g) => g.policies.length).map(({ c, policies }) => (
          <section key={c.key}>
            <div className="mb-1.5 flex items-center gap-2">
              <Eyebrow>{c.label}</Eyebrow>
              <span className="font-mono text-[11px] text-mist">{policies.filter((p) => p.status === "confirmed").length}/{policies.length} confirmed</span>
            </div>
            <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {policies.map((p) => <PolicyRow key={p.key} p={p} open={open === p.key} onToggle={() => setOpen(open === p.key ? null : p.key)} canManage={canManage} busy={busy} onRule={onRule} kernels={r.pack?.kernels ?? []} />)}
            </div>
          </section>
        ))}
      </CardBody>
    </Card>
  );
}

function PolicyRow({ p, open, onToggle, canManage, busy, onRule, kernels }: { p: BookPolicy; open: boolean; onToggle: () => void; canManage: boolean; busy: boolean; onRule: (key: string, ruling: Ruling, done: string) => void; kernels: { key: string; label: string; status: string }[] }) {
  const [mode, setMode] = useState<null | "set" | "dispute" | "retire">(null);
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const kernel = kernels.find((k) => k.key === p.kernel);
  const submit = () => {
    if (mode === "set") {
      const parameters: Record<string, ParamValue> = {};
      for (const [k, v] of Object.entries(values)) {
        const was = p.parameters[k];
        parameters[k] = typeof was === "number" ? Number(v) : typeof was === "boolean" ? v === "true" : v;
      }
      onRule(p.key, { action: "set", parameters, reason }, "New value confirmed.");
    } else if (mode) onRule(p.key, { action: mode, reason }, mode === "retire" ? "Retired." : "Disputed.");
    setMode(null);
    setReason("");
  };
  return (
    <div data-policy={p.key}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left hover:bg-panel-2">
        <span className="w-[86px] shrink-0 font-mono text-[11px] text-mist">{p.key}</span>
        <span className="min-w-0 flex-1 text-[14px]">{p.title}</span>
        <Chip tone={CRIT_TONE[p.criticality]}>{CRITICALITY_LABEL[p.criticality]}</Chip>
        <Chip tone={p.binding === "overridden" ? "gold" : p.binding === "site" ? "cyan" : "default"}>{BINDING_LABEL[p.binding]}</Chip>
        <Chip tone={STATUS_TONE[p.status]}>{p.status}</Chip>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-panel-2/40 px-4 py-3 text-[13.5px]">
          <p className="text-ink">{p.statement}</p>
          {Object.keys(p.parameters).length > 0 && (
            <div className="flex flex-wrap gap-2 font-mono text-[12px]">
              {Object.entries(p.parameters).map(([k, v]) => (
                <span key={k} className="rounded border border-line px-2 py-0.5">
                  {k} = <span className="text-gold-2">{String(v)}</span>
                  {p.packParameters && p.packParameters[k] !== undefined && p.packParameters[k] !== v && <span className="text-mist"> (pack: {String(p.packParameters[k])})</span>}
                </span>
              ))}
            </div>
          )}
          <dl className="grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[110px_1fr]">
            <dt className="text-mist">Form</dt><dd>{p.form === "parametric" ? "Parametric: changes as data, no code" : "Structural: lives in the kernel's code"}</dd>
            <dt className="text-mist">Runs through</dt><dd>{kernel ? `${kernel.label} (${kernel.status})` : "No kernel named"}</dd>
            <dt className="text-mist">Owner</dt><dd>{p.owner}{p.reviewBy ? ` · review by ${p.reviewBy}` : " · no review date"}</dd>
            {p.regulation && <><dt className="text-mist">Regulation</dt><dd>{p.regulation}</dd></>}
            {p.reason && <><dt className="text-mist">Reason</dt><dd>{p.reason}</dd></>}
            {p.ruledBy && <><dt className="text-mist">Ruled</dt><dd>{p.ruledBy}{p.ruledAt ? `, ${new Date(p.ruledAt).toLocaleString()}` : ""} · v{p.version}</dd></>}
            {p.sources.length > 0 && <><dt className="text-mist">In the code</dt><dd className="font-mono text-[11.5px]">{p.sources.map((s) => `${s.path}${s.lines ? `:${s.lines}` : ""}`).join(" · ")}</dd></>}
            {p.surfaces.length > 0 && <><dt className="text-mist">Stated on</dt><dd className="font-mono text-[11.5px]">{p.surfaces.join(" · ")}</dd></>}
          </dl>
          {p.examples.length > 0 && (
            <ul className="space-y-1 text-[12.5px]">
              {p.examples.map((e) => <li key={e.given} className="rounded border border-line px-2 py-1"><span className="text-mist">Given</span> {e.given} <span className="text-mist">when</span> {e.when} <span className="text-mist">then</span> {e.then}</li>)}
            </ul>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {p.status !== "confirmed" && <button type="button" className={button("gold")} disabled={busy} onClick={() => onRule(p.key, { action: "confirm" }, "Confirmed.")}>Confirm</button>}
              {p.form === "parametric" && Object.keys(p.parameters).length > 0 && <button type="button" className={button("plain")} onClick={() => { setMode("set"); setValues(Object.fromEntries(Object.entries(p.parameters).map(([k, v]) => [k, String(v)]))); }}>Change a value</button>}
              <button type="button" className={button("ghost")} onClick={() => setMode("dispute")}>Dispute</button>
              <button type="button" className={button("ghost")} onClick={() => setMode("retire")}>Retire</button>
            </div>
          )}
          {mode && (
            <div className="space-y-2 rounded-lg border border-line-2 p-3">
              {mode === "set" && Object.entries(values).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2 font-mono text-[12px]">
                  <span className="w-40 text-mist">{k}</span>
                  <input value={v} onChange={(e) => setValues({ ...values, [k]: e.target.value })} className="rounded border border-line-2 bg-panel-2 px-2 py-1" />
                </label>
              ))}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "set" ? "Why this value?" : mode === "retire" ? "Why retire it?" : "What's wrong with it?"} className="w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-1.5 text-[13px]" />
              <div className="flex gap-2">
                <button type="button" className={button("gold")} disabled={busy || !reason.trim()} onClick={submit}>{mode === "set" ? "Confirm the new value" : mode === "retire" ? "Retire" : "Dispute"}</button>
                <button type="button" className={button("ghost")} onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

