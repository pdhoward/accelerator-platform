"use client";

import { useState } from "react";
import { proposalLabel, SKILL_FORM, SKILL_TIER_LABEL, type CrewResponse, type SkillProposal, type SkillTier } from "@accelerator/domain";
import { BookOpen, Download, FlaskConical, Lock, Sparkles } from "lucide-react";

import { browserApi } from "@/lib/browser-api";
import { DocDrawer } from "./cockpit/work-sidebar";
import { FormRenderer } from "./form-renderer";
import { button, Card, CardBody, CardHead, Chip, cx } from "./ui";
import { useUi } from "./ui-provider";

/**
 * Crew & Knowledge (gen2-crew.md §2.4, G2.3): your Team Lead and crew (remit,
 * boundaries, actual activity), what the crew knows by tier, the learning
 * proposals, and the Library's export. Clients approve; they don't assemble.
 */

const TIER_TONE: Record<SkillTier, "violet" | "cyan" | "gold" | "good" | "default"> = { crew: "violet", domain: "cyan", partner: "gold", org: "good", site: "default" };

export function CrewView({
  siteId,
  initial,
  initialProposals,
  can,
}: {
  siteId: string;
  initial: CrewResponse;
  initialProposals: SkillProposal[];
  can: { configure: boolean; decide: boolean; propose: boolean; export: boolean; engineer: boolean };
}) {
  const [crew, setCrew] = useState(initial);
  const [proposals, setProposals] = useState(initialProposals);
  const [proposing, setProposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast, engineer } = useUi();
  const api = browserApi();

  const reload = async () => {
    const [c, p] = await Promise.all([api.crew.get(siteId), api.crew.proposals(siteId)]);
    setCrew(c);
    setProposals(p);
  };
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

  /** A crew or domain skill switches through a new crew version; a company or site skill switches in place. */
  function toggle(skill: CrewResponse["handbook"][number]) {
    if (skill.locked) return;
    if (skill.tier === "crew" || skill.tier === "domain") {
      const off = new Set(crew.config.disabledSkills);
      if (skill.on) off.add(skill.key);
      else off.delete(skill.key);
      return act(() => api.crew.save(siteId, { ...crew.config, disabledSkills: [...off] }, `${skill.on ? "Switched off" : "Switched on"}: ${skill.title}`), `Crew v${crew.crewVersion + 1}: ${skill.title} ${skill.on ? "off" : "on"}.`);
    }
    return act(() => api.crew.skill(siteId, skill.id!, !skill.on), `${skill.title} ${skill.on ? "off" : "on"}.`);
  }

  const lead = crew.members.find((m) => m.id === "lead")!;
  const others = crew.members.filter((m) => m.id !== "lead");
  const open = proposals.filter((p) => p.status === "proposed");
  const decided = proposals.filter((p) => p.status !== "proposed");
  const tiers = (["crew", "domain", "partner", "org", "site"] as SkillTier[]).filter((t) => crew.handbook.some((k) => k.tier === t));

  return (
    <>
      {crew.sample && (
        <p className="text-sm text-warn" data-sample>
          Sample: the crew catalog and its Commerce skills, with no site records. A real site shows its own crew version, activity and proposals.
        </p>
      )}
      <Card>
        <CardBody className="flex flex-col gap-3 pt-5 md:flex-row md:items-start" data-team-lead>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-violet/15 text-lg font-semibold text-violet" aria-hidden>TL</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">Your Team Lead</h2>
              <Presence m={lead} />
              <span className="font-mono text-[11px] text-mist">crew v{crew.crewVersion} · catalog v{crew.catalogVersion}{crew.domain ? ` · ${crew.domain}` : ""}</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-fog">{lead.remit}</p>
            <Boundaries list={lead.permissions} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Your crew" hint="Presence comes from real jobs; a card never means an agent is always thinking" />
        <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-crew>
          {others.map((m) => (
            <article key={m.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-panel-2 p-3.5" data-specialist={m.id}>
              <div className="flex items-center gap-2">
                <h3 className="text-[13.5px] font-semibold">{m.label}</h3>
                <Presence m={m} />
                <span className="ml-auto text-[11px] text-mist">{m.runs === "model" ? "model" : m.runs === "checks" ? "runs checks" : "rules (v0)"}</span>
              </div>
              <p className="text-[12.5px] leading-snug text-fog">{m.remit}</p>
              <Boundaries list={m.permissions} />
              {(engineer || can.engineer) && m.toolsAllowed.length > 0 && <p className="font-mono text-[11px] text-mist">tools: {m.toolsAllowed.join(", ")}</p>}
              <p className="mt-auto text-[11.5px] text-mist">{m.activity.jobs} run{m.activity.jobs === 1 ? "" : "s"} in 30 days · {m.runs === "model" ? `${m.skills.length} skills` : "no model, so no skills"}</p>
            </article>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="What the crew knows" hint="Assembled crew → domain → partner → company → site; a safety skill can't be switched off">
          {can.propose && (
            <button type="button" className={button("plain")} onClick={() => setProposing(true)}>
              <BookOpen className="size-4" /> Propose a skill
            </button>
          )}
        </CardHead>
        <CardBody className="flex flex-col gap-4" data-handbook>
          {tiers.map((t) => (
            <section key={t}>
              <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mist">{SKILL_TIER_LABEL[t]}</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {crew.handbook.filter((k) => k.tier === t).map((k) => (
                  <details key={k.key} className={cx("group min-w-0 rounded-xl border border-line bg-panel-2 px-3.5 py-2.5", !k.on && "opacity-60")}>
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      <Chip tone={TIER_TONE[k.tier]}>{SKILL_TIER_LABEL[k.tier]} v{k.version}</Chip>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{k.title}</span>
                      {k.locked ? (
                        <span title="A crew safety skill" className="text-mist"><Lock className="size-3.5" aria-label="Locked" /></span>
                      ) : (
                        can.configure && (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={k.on}
                            aria-label={`${k.title} ${k.on ? "on" : "off"}`}
                            disabled={busy}
                            onClick={(e) => { e.preventDefault(); void toggle(k); }}
                            className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50", k.on ? "bg-violet" : "bg-line-2")}
                          >
                            <span className={cx("absolute left-0 top-[3px] size-3.5 rounded-full bg-white transition-transform", k.on ? "translate-x-[18px]" : "translate-x-[3px]")} />
                          </button>
                        )
                      )}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-fog">{k.body}</pre>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Learning proposals" hint="Proposed, activated and evaluated are different claims">
          {can.configure && (
            <button type="button" className={button("ghost")} disabled={busy} onClick={() => act(async () => {
              const r = await api.crew.skillsmith(siteId);
              if (!r.proposed) throw new Error("The Skillsmith found no pattern that repeats across Work items yet.");
            }, "The Skillsmith filed new proposals from the evidence.")}>
              <Sparkles className="size-4" /> Ask the Skillsmith
            </button>
          )}
        </CardHead>
        <CardBody className="flex flex-col gap-3" data-proposals>
          {open.length === 0 && <p className="text-[13px] text-mist">No open proposals. The Skillsmith reads the evidence after every release.</p>}
          {open.map((p) => (
            <article key={p.id} className="rounded-xl border border-gold/40 bg-panel-2 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13.5px] font-semibold">{p.title}</h3>
                <Chip tone="gold">{proposalLabel(p)}</Chip>
                <Chip>{p.source === "skillsmith" ? "Skillsmith" : "a person"}</Chip>
                <Chip>{p.scope === "org" ? "every site" : "this site"}</Chip>
              </div>
              <p className="mt-1.5 text-[12.5px] text-fog"><strong className="font-medium text-ink">Why:</strong> {p.rationale}</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-panel px-3 py-2 font-sans text-[12.5px] leading-relaxed text-fog">{p.body}</pre>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-mist"><FlaskConical className="size-3" /> Not evaluated: replay and holdout tests arrive with the Crew Lab&apos;s test bench.</p>
              {can.decide && (
                <div className="mt-2.5 flex gap-2">
                  <button type="button" className={button("gold", "py-1")} disabled={busy} onClick={() => act(() => api.crew.decide(siteId, p.id, "approve"), `Activated: ${p.title}. The crew uses it from the next run.`)}>Approve</button>
                  <button type="button" className={button("ghost", "py-1")} disabled={busy} onClick={() => act(() => api.crew.decide(siteId, p.id, "reject"), "Declined.")}>Decline</button>
                </div>
              )}
            </article>
          ))}
          {decided.length > 0 && (
            <details className="text-[12.5px] text-fog">
              <summary className="cursor-pointer text-mist">Decided ({decided.length})</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {decided.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <span>{p.title}</span>
                    <Chip tone={p.status === "approved" ? "good" : "default"}>{proposalLabel(p)}</Chip>
                    {p.decidedBy && <span className="text-mist">by {p.decidedBy}</span>}
                    {p.status === "approved" && can.decide && (
                      <button type="button" className={button("ghost", "px-2 py-0.5 text-[12px]")} disabled={busy} onClick={() => act(() => api.crew.decide(siteId, p.id, "rollback"), `Rolled back: ${p.title}.`)}>Roll back</button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Library and export" hint="Decisions, documents, evidence, capabilities and learning; never secrets" />
        <CardBody className="flex flex-wrap items-center gap-3">
          <a href={`/s/${siteId}/timeline`} className={button("plain")}>Open the Site Timeline</a>
          {can.export && (
            <a href={api.exportUrl(siteId)} download className={button("plain")} data-export>
              <Download className="size-4" /> Export the record (JSON)
            </a>
          )}
          {crew.history.length > 0 && (
            <span className="text-[12px] text-mist">Crew v{crew.history[0]!.version} by {crew.history[0]!.by}{crew.history[0]!.note ? `: ${crew.history[0]!.note}` : ""}</span>
          )}
        </CardBody>
      </Card>

      {proposing && (
        <DocDrawer title="Propose a skill" onClose={() => setProposing(false)}>
          <FormRenderer
            spec={SKILL_FORM}
            initial={{ specialist: "all", scope: "site" }}
            onCancel={() => setProposing(false)}
            onSubmit={async (values) => {
              await act(() => api.crew.propose(siteId, values), "Proposed. The Owner approves it before the crew uses it.");
              setProposing(false);
            }}
          />
        </DocDrawer>
      )}
    </>
  );
}

function Presence({ m }: { m: CrewResponse["members"][number] }) {
  if (m.activity.working) return <Chip tone="good">working: {m.activity.working}</Chip>;
  if (m.runs !== "model" && m.activity.jobs === 0 && !m.jobs.length) return <Chip>on call</Chip>;
  return <Chip>{m.activity.lastAt ? `last ran ${m.activity.lastAt.slice(0, 10)}` : "available"}</Chip>;
}

/** The gates a specialist stops at: fixed by policy, so shown as locks. */
function Boundaries({ list }: { list: string[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-1" aria-label="Boundaries">
      {list.map((p) => (
        <li key={p} className="flex items-start gap-1.5 text-[12px] leading-snug text-fog">
          <Lock className="mt-0.5 size-3 shrink-0 text-mist" aria-hidden /> {p}
        </li>
      ))}
    </ul>
  );
}
