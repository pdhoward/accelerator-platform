import {
  assembleSkills,
  CREW,
  CREW_CATALOG_VERSION,
  CREW_SKILLS,
  crewConfigErrors,
  DEFAULT_CREW_CONFIG,
  DOMAIN_SKILLS,
  isDomain,
  readCrewConfig,
  skillsmithProposals,
  SPECIALISTS,
  specialistFor,
  toolsAllowed,
  type CrewConfig,
  type CrewContext,
  type CrewResponse,
  type Domain,
  type FailureFact,
  type Identity,
  type JobKind,
  type SkillProposal,
  type SkillRecord,
  type Site,
  type SpecialistId,
} from "@accelerator/domain";

import { CodeError } from "./codes";
import { record } from "./ledger";
import { db, rows, type Row } from "./supabase";

/**
 * The crew on the server (gen2-crew.md §2, G2.3): each site's crew settings
 * as versioned records, the partner, company and site skill tiers, what each
 * job is given, and the Skillsmith's proposals. packages/domain decides what
 * is allowed; this reads and writes the records.
 */

const now = () => new Date().toISOString();
const site = (s: Pick<Site, "id" | "orgId">) => ({ org_id: s.orgId, site_id: s.id });
const isSpecialist = (v: unknown): v is SpecialistId => typeof v === "string" && (SPECIALISTS as readonly string[]).includes(v);

/** The live crew settings: the highest version, or the catalog's defaults as version 0. */
export async function crewConfig(siteId: string): Promise<{ version: number; config: CrewConfig }> {
  const [top] = await rows(db().from("acc_crew_versions").select("version, config").eq("site_id", siteId).order("version", { ascending: false }).limit(1));
  return top ? { version: top.version as number, config: readCrewConfig(top.config) } : { version: 0, config: DEFAULT_CREW_CONFIG };
}

const toRecord = (r: Row): SkillRecord => ({
  id: r.id as string,
  scope: r.scope as SkillRecord["scope"],
  title: r.name as string,
  body: r.body as string,
  version: Number.parseInt(String(r.version), 10) || 1,
  specialists: ((r.specialists as string[]) ?? []).filter(isSpecialist),
  enabled: !!r.enabled,
});

/** Partner, company and site skills for one site (legacy rows without a scope never reach a prompt). */
export async function skillRecords(s: { id: string; orgId: string }): Promise<SkillRecord[]> {
  const [org] = await rows(db().from("acc_orgs").select("partner_id").eq("id", s.orgId));
  const [siteRows, orgRows, partnerRows] = await Promise.all([
    rows(db().from("acc_skills").select("*").eq("scope", "site").eq("site_id", s.id)),
    rows(db().from("acc_skills").select("*").eq("scope", "org").eq("org_id", s.orgId)),
    org?.partner_id ? rows(db().from("acc_skills").select("*").eq("scope", "partner").eq("partner_id", org.partner_id as string)) : Promise.resolve([] as Row[]),
  ]);
  return [...partnerRows, ...orgRows, ...siteRows].map(toRecord);
}

/** What one job runs with: its specialist, the assembled skills and the crew version (recorded on the job). */
export async function crewContext(s: { id: string; orgId: string; domain: Domain | null }, kind: JobKind): Promise<CrewContext & { tools: string[] }> {
  const [{ version, config }, records] = await Promise.all([crewConfig(s.id), skillRecords(s)]);
  const specialist = specialistFor(kind);
  return {
    specialist, label: CREW[specialist].label, crewVersion: version,
    skills: assembleSkills({ specialist, domain: s.domain, config, records }),
    tools: toolsAllowed(specialist, config),
  };
}

const domainOf = async (siteId: string): Promise<Domain | null> => {
  const [s] = await rows(db().from("acc_sites").select("domain").eq("id", siteId));
  return isDomain(s?.domain) ? s.domain : null;
};

/** The client's Crew & Knowledge view (§2.4): remit, boundaries, actual activity, and the handbook by tier. */
export async function readCrew(s: Site): Promise<CrewResponse> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ version, config }, records, domain, jobs, history] = await Promise.all([
    crewConfig(s.id),
    skillRecords(s),
    domainOf(s.id),
    rows(db().from("acc_jobs").select("kind, status, created_at, work_id").eq("site_id", s.id).gte("created_at", since).order("created_at", { ascending: false }).limit(500)),
    rows(db().from("acc_crew_versions").select("version, note, created_label, created_at").eq("site_id", s.id).order("version", { ascending: false }).limit(20)),
  ]);
  return crewView({
    version, config, domain, records, jobs,
    history: history.map((h) => ({ version: h.version as number, note: (h.note as string) ?? null, by: h.created_label as string, at: h.created_at as string })),
  });
}

/** The crew catalog alone, for the keyless demo: no records, so no activity and no versions, and labelled as a sample. */
export const catalogCrew = (domain: Domain | null): CrewResponse => ({
  ...crewView({ version: 0, config: DEFAULT_CREW_CONFIG, domain, records: [], jobs: [], history: [] }),
  sample: true,
});

function crewView(v: { version: number; config: CrewConfig; domain: Domain | null; records: SkillRecord[]; jobs: Row[]; history: CrewResponse["history"] }): CrewResponse {
  const { config, domain, records, jobs } = v;
  const members = SPECIALISTS.map((id) => {
    const spec = CREW[id];
    const mine = jobs.filter((j) => spec.jobs.includes(j.kind as JobKind));
    const running = mine.find((j) => j.status === "running");
    return {
      ...spec,
      toolsAllowed: toolsAllowed(id, config),
      skills: assembleSkills({ specialist: id, domain, config, records }).map((k) => ({ key: k.key, title: k.title, tier: k.tier, version: k.version, safety: !!k.safety })),
      activity: { jobs: mine.length, lastAt: (mine[0]?.created_at as string) ?? null, working: running ? `a ${String(running.kind).replace("_", " ")} run` : null },
    };
  });
  const off = new Set(config.disabledSkills);
  const handbook = [
    ...CREW_SKILLS.map((k) => ({ ...k, on: !!k.safety || !off.has(k.key), locked: !!k.safety })),
    ...DOMAIN_SKILLS.filter((k) => k.domain === domain).map((k) => ({ ...k, on: !off.has(k.key), locked: false })),
    ...records.map((r) => ({ key: `${r.scope}.${r.id}`, id: r.id, tier: r.scope, title: r.title, body: r.body, version: r.version, specialists: r.specialists, enabled: r.enabled, on: r.enabled, locked: false })),
  ];
  return { catalogVersion: CREW_CATALOG_VERSION, crewVersion: v.version, config, domain, members, handbook, history: v.history };
}

/** A new crew version: validated against the catalog; a safety skill or a widened tool is refused. */
export async function saveCrew(s: Site, identity: Identity, name: string, input: unknown, note?: string) {
  const config = readCrewConfig(input);
  const errors = crewConfigErrors(config, await domainOf(s.id));
  if (errors.length) throw new CodeError(errors.join(" "));
  const { version } = await crewConfig(s.id);
  const { error } = await db().from("acc_crew_versions").insert({ ...site(s), version: version + 1, config, note: note?.slice(0, 300) ?? null, created_by: identity.userId, created_label: name });
  if (error) throw new CodeError(error.message.includes("duplicate") ? "Someone saved the crew a moment ago. Reload and try again." : error.message);
  await record({ ...site(s), id: null }, {
    kind: "crew", actor: { kind: "person", userId: identity.userId, label: name }, summary: `Crew v${version + 1} saved${note ? `: ${note.slice(0, 140)}` : "."}`, refs: { crewVersion: version + 1 },
  });
  return { version: version + 1 };
}

/** Switch a company or site skill on or off (a crew or domain skill is switched through the crew settings). */
export async function setSkillEnabled(s: Site, identity: Identity, name: string, id: string, enabled: boolean) {
  const [r] = await rows(db().from("acc_skills").select("*").eq("id", id));
  if (!r || !r.scope || (r.scope === "site" && r.site_id !== s.id) || (r.scope === "org" && r.org_id !== s.orgId)) throw new CodeError("That skill isn't this site's to change.");
  await db().from("acc_skills").update({ enabled, updated_at: now() }).eq("id", id);
  await record({ ...site(s), id: null }, { kind: "skill", actor: { kind: "person", userId: identity.userId, label: name }, summary: `Skill "${r.name}" switched ${enabled ? "on" : "off"}.`, refs: { skill: id } });
}

// ── Proposals (the Skillsmith, and people) ─────────────────────────────────
const toProposal = (r: Row): SkillProposal => ({
  id: r.id as string,
  kind: r.kind as SkillProposal["kind"],
  skillId: (r.skill_id as string) ?? null,
  scope: r.scope as SkillProposal["scope"],
  title: r.title as string,
  body: r.body as string,
  previousBody: (r.previous_body as string) ?? null,
  specialists: ((r.specialists as string[]) ?? []).filter(isSpecialist),
  rationale: r.rationale as string,
  evidence: (r.evidence as Record<string, unknown>) ?? {},
  source: r.source as SkillProposal["source"],
  status: r.status as SkillProposal["status"],
  evaluation: (r.evaluation as string) ?? "not evaluated",
  decidedBy: (r.decided_label as string) ?? null,
  decidedAt: (r.decided_at as string) ?? null,
  createdAt: r.created_at as string,
});

export async function listProposals(siteId: string): Promise<SkillProposal[]> {
  return (await rows(db().from("acc_skill_proposals").select("*").eq("site_id", siteId).order("created_at", { ascending: false }).limit(100))).map(toProposal);
}

/** A person's own skill, as a proposal the Owner approves (it never goes live unreviewed). */
export async function proposeSkill(s: Site, identity: Identity, name: string, input: { title: string; body: string; specialist: string; scope: "site" | "org" }) {
  const specialists = input.specialist === "all" || !isSpecialist(input.specialist) ? [] : [input.specialist];
  const { data, error } = await db()
    .from("acc_skill_proposals")
    .insert({
      ...site(s), kind: "new", scope: input.scope, title: input.title.slice(0, 120), body: input.body.slice(0, 4000), specialists,
      rationale: `Proposed by ${name}.`, source: "person", evidence: { by: name }, status: "proposed",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await record({ ...site(s), id: null }, { kind: "skill", actor: { kind: "person", userId: identity.userId, label: name }, summary: `Skill proposed: "${input.title.slice(0, 120)}".`, refs: { proposal: (data as Row).id } });
  return toProposal(data as Row);
}

/**
 * Approve (the skill goes live, at the next version), decline, or roll back
 * an approved proposal (the skill returns to its previous text, or is
 * switched off if it was new). Every decision is on the ledger.
 */
export async function decideProposal(s: Site, identity: Identity, name: string, id: string, decision: "approve" | "reject" | "rollback") {
  const [p] = await rows(db().from("acc_skill_proposals").select("*").eq("id", id).eq("site_id", s.id));
  if (!p) throw new CodeError("That proposal doesn't exist.");
  const decided = { decided_by: identity.userId, decided_label: name, decided_at: now() };
  const scope = { ...site(s), id: null };

  if (decision === "reject") {
    if (p.status !== "proposed") throw new CodeError("Only an open proposal can be declined.");
    await db().from("acc_skill_proposals").update({ status: "rejected", ...decided }).eq("id", id);
    await record(scope, { kind: "skill", actor: { kind: "person", userId: identity.userId, label: name }, summary: `Skill proposal declined: "${p.title}".`, refs: { proposal: id } });
    return;
  }

  if (decision === "approve") {
    if (p.status !== "proposed") throw new CodeError("That proposal was already decided.");
    let skillId = p.skill_id as string | null;
    if (skillId) {
      const [cur] = await rows(db().from("acc_skills").select("version, body").eq("id", skillId));
      const version = (Number.parseInt(String(cur?.version ?? "1"), 10) || 1) + 1;
      await db().from("acc_skill_proposals").update({ previous_body: (cur?.body as string) ?? null }).eq("id", id);
      await db().from("acc_skills").update({ body: p.body, name: p.title, version: String(version), enabled: p.kind !== "retire", updated_at: now() }).eq("id", skillId);
    } else {
      const { data, error } = await db()
        .from("acc_skills")
        .insert({
          org_id: s.orgId, site_id: p.scope === "site" ? s.id : null, scope: p.scope, name: p.title, category: "engineering",
          description: String(p.rationale).slice(0, 300), version: "1", body: p.body, enabled: true, source: "custom", specialists: p.specialists ?? [], created_by: identity.userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      skillId = (data as Row).id as string;
    }
    await db().from("acc_skill_proposals").update({ status: "approved", skill_id: skillId, ...decided }).eq("id", id);
    await record(scope, { kind: "skill", actor: { kind: "person", userId: identity.userId, label: name }, summary: `Skill activated: "${p.title}" (not evaluated).`, counts: true, refs: { proposal: id, skill: skillId } });
    return;
  }

  if (p.status !== "approved" || !p.skill_id) throw new CodeError("Only an activated proposal can be rolled back.");
  if (p.previous_body) {
    const [cur] = await rows(db().from("acc_skills").select("version").eq("id", p.skill_id as string));
    await db().from("acc_skills").update({ body: p.previous_body, version: String((Number.parseInt(String(cur?.version ?? "1"), 10) || 1) + 1), enabled: true, updated_at: now() }).eq("id", p.skill_id as string);
  } else {
    await db().from("acc_skills").update({ enabled: false, updated_at: now() }).eq("id", p.skill_id as string);
  }
  await db().from("acc_skill_proposals").update({ status: "rolled_back", ...decided }).eq("id", id);
  await record(scope, { kind: "skill", actor: { kind: "person", userId: identity.userId, label: name }, summary: `Skill rolled back: "${p.title}".`, refs: { proposal: id, skill: p.skill_id } });
}

/**
 * The Skillsmith's sweep for one site: read recent failures and escalations,
 * and file a proposal for each pattern that repeats. Runs after each
 * release and on request; never activates anything.
 */
export async function runSkillsmith(s: Pick<Site, "id" | "orgId">): Promise<number> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [work, evidence, tiers, proposals] = await Promise.all([
    rows(db().from("acc_work").select("id, number, title").eq("site_id", s.id)),
    rows(db().from("acc_evidence").select("work_id, kind, ok, detail, created_at").eq("site_id", s.id).in("kind", ["step_checks", "prove"]).eq("ok", false).gte("created_at", since).limit(500)),
    rows(db().from("acc_decisions").select("work_id, created_at, detail, target").eq("site_id", s.id).eq("kind", "tier").eq("target", "high").gte("created_at", since)),
    rows(db().from("acc_skill_proposals").select("rule, status").eq("site_id", s.id)),
  ]);
  const byId = new Map(work.map((w) => [w.id as string, w]));
  const failures: FailureFact[] = evidence.flatMap((e) => {
    const w = byId.get(e.work_id as string);
    return w ? [{ work: w.number as number, title: w.title as string, at: e.created_at as string, kind: e.kind as FailureFact["kind"], ok: false, reasons: (((e.detail as Row)?.reasons as string[]) ?? []).map(String) }] : [];
  });
  const escalations = tiers.flatMap((t) => {
    const w = byId.get(t.work_id as string);
    const files = ((t.detail as Row)?.files as string[]) ?? [];
    return w && files.length ? [{ work: w.number as number, at: t.created_at as string, files }] : [];
  });
  const open = proposals.filter((p) => p.rule && (p.status === "proposed" || p.status === "approved")).map((p) => p.rule as string);
  const drafts = skillsmithProposals({ failures, escalations, now: now(), open });
  for (const d of drafts) {
    await db().from("acc_skill_proposals").insert({
      ...site(s), kind: "new", scope: "site", title: d.title, body: d.body, specialists: d.specialists, rationale: d.rationale, evidence: d.evidence, source: "skillsmith", rule: d.rule, status: "proposed",
    });
    await record({ ...site(s), id: null }, { kind: "skill", actor: { kind: "crew", label: "Skillsmith" }, summary: `Proposed "${d.title}": ${d.rationale}`, refs: { rule: d.rule } });
  }
  return drafts.length;
}
