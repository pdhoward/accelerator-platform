import {
  capabilitiesTouched,
  capabilityCondition,
  capabilityProgress,
  CAPABILITY_FORM,
  formErrors,
  isDomain,
  journeysFor,
  proposeCapabilities,
  readForm,
  scorecard,
  type CapabilitiesResponse,
  type Capability,
  type Identity,
  type Lifecycle,
  type Site,
  type WorkStage,
} from "@accelerator/domain";

import { CodeError } from "./codes";
import { repoPaths } from "./github";
import { record } from "./ledger";
import { db, rows, type Row } from "./supabase";

/**
 * The capability inventory on the server (gen2-crew.md §10.3, G2.3a). The
 * Surveyor proposes from the repository; a person accepts, edits, retires or
 * links. Condition comes from evidence and progress from linked Work items,
 * computed in packages/domain.
 */

const now = () => new Date().toISOString();
const scope = (s: Pick<Site, "id" | "orgId">) => ({ org_id: s.orgId, site_id: s.id, id: null });
const person = (identity: Identity, name: string) => ({ kind: "person" as const, userId: identity.userId, label: name });

export async function readCapabilities(site: Site): Promise<CapabilitiesResponse> {
  const [caps, links, work, suite, siteRow] = await Promise.all([
    rows(db().from("acc_capabilities").select("*").eq("site_id", site.id).order("area")),
    rows(db().from("acc_capability_work").select("capability_id, work_id").eq("site_id", site.id)),
    rows(db().from("acc_work").select("id, number, title, stage").eq("site_id", site.id)),
    // The latest full-suite run on a candidate: Prove or a release.
    rows(db().from("acc_evidence").select("ok, created_at, kind").eq("site_id", site.id).in("kind", ["prove", "release"]).order("created_at", { ascending: false }).limit(1)),
    rows(db().from("acc_sites").select("domain").eq("id", site.id)),
  ]);
  const at = now();
  const latest = suite[0] ? { ok: !!suite[0].ok, at: suite[0].created_at as string, kind: suite[0].kind as string } : null;
  const workById = new Map(work.map((w) => [w.id as string, w]));
  const capabilities: Capability[] = caps.map((c) => {
    const tests = ((c.evidence as Row)?.tests as string[]) ?? [];
    const linked = links.filter((l) => l.capability_id === c.id).map((l) => workById.get(l.work_id as string)).filter((w): w is Row => !!w);
    return {
      id: c.id as string, key: c.key as string, area: c.area as string, name: c.name as string, purpose: (c.purpose as string) ?? "",
      lifecycle: c.lifecycle as Lifecycle, importance: c.importance as Capability["importance"], paths: (c.paths as string[]) ?? [], tests,
      requirements: ((c.requirements as Capability["requirements"]) ?? []), version: (c.version as number) ?? 1, source: c.source as Capability["source"],
      confidence: c.confidence == null ? null : Number(c.confidence), evidence: (c.evidence as Record<string, unknown>) ?? {},
      reviewedBy: (c.reviewed_label as string) ?? null, reviewedAt: (c.reviewed_at as string) ?? null,
      condition: capabilityCondition({ lifecycle: c.lifecycle as Lifecycle, tests: tests.length }, latest, at),
      progress: capabilityProgress(linked.map((w) => ({ number: w.number as number, title: w.title as string, stage: w.stage as WorkStage }))),
    };
  });
  const domain = isDomain(siteRow[0]?.domain) ? siteRow[0]!.domain : null;
  const surveyed = caps.filter((c) => c.source === "survey").map((c) => c.created_at as string).sort().at(-1) ?? null;
  return { capabilities, scorecard: scorecard(capabilities), journeys: journeysFor(domain, capabilities), surveyedAt: surveyed };
}

/**
 * The Surveyor's pass: propose capabilities from the repository's files.
 * New keys arrive as proposals; an existing capability only has its
 * technical links and evidence refreshed, never its accepted fields.
 */
export async function surveyCapabilities(site: Site, identity: Identity, name: string): Promise<{ proposed: number; refreshed: number }> {
  const [paths, siteRow, existing] = await Promise.all([
    repoPaths(site),
    rows(db().from("acc_sites").select("domain").eq("id", site.id)),
    rows(db().from("acc_capabilities").select("id, key, lifecycle").eq("site_id", site.id)),
  ]);
  const domain = isDomain(siteRow[0]?.domain) ? siteRow[0]!.domain : null;
  const proposals = proposeCapabilities(paths, domain);
  let proposed = 0;
  let refreshed = 0;
  for (const p of proposals) {
    const found = existing.find((e) => e.key === p.key);
    const evidence = { ...p.evidence, tests: p.tests };
    if (found) {
      if (found.lifecycle === "retired") continue;
      await db().from("acc_capabilities").update({ paths: p.paths, evidence, confidence: p.confidence, updated_at: now() }).eq("id", found.id as string);
      refreshed += 1;
    } else {
      await db().from("acc_capabilities").insert({
        org_id: site.orgId, site_id: site.id, key: p.key, area: p.area, name: p.name, purpose: p.purpose, importance: p.importance,
        paths: p.paths, source: "survey", confidence: p.confidence, evidence, lifecycle: "proposed",
      });
      proposed += 1;
    }
  }
  await record(scope(site), {
    kind: "survey", actor: { kind: "crew", label: "Surveyor" },
    summary: `Capability survey: ${proposed} proposed, ${refreshed} refreshed from ${paths.length} files${domain ? ` (${domain})` : ""}. ${identity ? `Asked by ${name}.` : ""}`.trim(),
  });
  return { proposed, refreshed };
}

async function capabilityRow(site: Site, id: string): Promise<Row> {
  const [c] = await rows(db().from("acc_capabilities").select("*").eq("id", id).eq("site_id", site.id));
  if (!c) throw new CodeError("That capability doesn't exist.");
  return c;
}

/** Accept, retire (with the reason) or restore a capability: a person's review, on the ledger. */
export async function reviewCapability(site: Site, identity: Identity, name: string, id: string, action: "accept" | "retire" | "restore", reason?: string) {
  const c = await capabilityRow(site, id);
  const lifecycle: Lifecycle = action === "accept" || action === "restore" ? (action === "restore" && !c.reviewed_at ? "proposed" : "accepted") : "retired";
  if (action === "retire" && !reason?.trim()) throw new CodeError("Say why it's retired; the record keeps the reason.");
  await db()
    .from("acc_capabilities")
    .update({ lifecycle, reviewed_by: identity.userId, reviewed_label: name, reviewed_at: now(), retired_reason: action === "retire" ? reason!.trim().slice(0, 300) : null, updated_at: now() })
    .eq("id", id);
  await record(scope(site), { kind: "capability", actor: person(identity, name), summary: `${c.name}: ${action === "accept" ? "accepted into the inventory" : action === "retire" ? `retired (${reason!.trim().slice(0, 120)})` : "restored"}.`, refs: { capability: id } });
}

/** Edit what a capability is; a change to its requirements is a new version. Identity (the key) never changes. */
export async function editCapability(site: Site, identity: Identity, name: string, id: string, input: unknown) {
  const c = await capabilityRow(site, id);
  const v = readForm(CAPABILITY_FORM, input);
  const errors = formErrors(CAPABILITY_FORM, v);
  if (Object.keys(errors).length) throw new CodeError(Object.values(errors).join(" "));
  const requirements = ((v.requirements as string[]) ?? []).map((line) => {
    const [text, acceptance] = line.split(/\s+[—-]\s+/, 2);
    return { text: text!.trim(), acceptance: (acceptance ?? "").trim() };
  });
  const changedReqs = JSON.stringify(requirements) !== JSON.stringify(c.requirements ?? []);
  await db()
    .from("acc_capabilities")
    .update({
      name: v.name, area: v.area, purpose: v.purpose ?? "", importance: v.importance, requirements, paths: (v.paths as string[]) ?? [],
      version: ((c.version as number) ?? 1) + (changedReqs ? 1 : 0), updated_at: now(), source: c.source === "survey" && !c.reviewed_at ? "person" : c.source,
    })
    .eq("id", id);
  await record(scope(site), { kind: "capability", actor: person(identity, name), summary: `${v.name}: edited${changedReqs ? ` (requirements v${((c.version as number) ?? 1) + 1})` : ""}.`, refs: { capability: id } });
}

/** A capability a person adds by hand (planned or missed by the Survey). */
export async function addCapability(site: Site, identity: Identity, name: string, input: unknown) {
  const v = readForm(CAPABILITY_FORM, input);
  const errors = formErrors(CAPABILITY_FORM, v);
  if (Object.keys(errors).length) throw new CodeError(Object.values(errors).join(" "));
  const key = `custom.${String(v.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
  const { data, error } = await db()
    .from("acc_capabilities")
    .insert({ org_id: site.orgId, site_id: site.id, key, area: v.area, name: v.name, purpose: v.purpose ?? "", importance: v.importance, paths: (v.paths as string[]) ?? [], source: "person", lifecycle: "accepted", reviewed_by: identity.userId, reviewed_label: name, reviewed_at: now() })
    .select("id")
    .single();
  if (error) throw new CodeError(error.message.includes("duplicate") ? "A capability with that name already exists." : error.message);
  await record(scope(site), { kind: "capability", actor: person(identity, name), summary: `${v.name}: added to the inventory.`, refs: { capability: (data as Row).id } });
  return { id: (data as Row).id as string };
}

/** After a build step: link the Work item to every capability its changed files touched. */
export async function linkCapabilities(w: Row, files: string[]) {
  if (!files.length) return;
  try {
    const caps = await rows(db().from("acc_capabilities").select("id, paths, lifecycle").eq("site_id", w.site_id as string));
    const touched = capabilitiesTouched(caps.map((c) => ({ id: c.id as string, paths: (c.paths as string[]) ?? [], lifecycle: c.lifecycle as Lifecycle })), files);
    for (const t of touched) {
      const [link] = await rows(db().from("acc_capability_work").select("files").eq("capability_id", t.id).eq("work_id", w.id as string));
      if (link) await db().from("acc_capability_work").update({ files: [...new Set([...((link.files as string[]) ?? []), ...t.files])] }).eq("capability_id", t.id).eq("work_id", w.id as string);
      else await db().from("acc_capability_work").insert({ capability_id: t.id, work_id: w.id, org_id: w.org_id, site_id: w.site_id, via: "files", files: t.files });
    }
  } catch (err) {
    console.error("[capabilities] link:", err instanceof Error ? err.message : err); // a link is a convenience; never fail the step
  }
}

/** The capabilities a Work item is linked to (its sidebar). */
export async function workCapabilities(workId: string): Promise<{ id: string; name: string; area: string }[]> {
  const links = await rows(db().from("acc_capability_work").select("capability_id").eq("work_id", workId));
  if (!links.length) return [];
  const caps = await rows(db().from("acc_capabilities").select("id, name, area").in("id", links.map((l) => l.capability_id as string)));
  return caps.map((c) => ({ id: c.id as string, name: c.name as string, area: c.area as string }));
}
