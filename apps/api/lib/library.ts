import {
  exportManifest,
  INTERVIEW_FORM,
  interviewMarkdown,
  isComplexity,
  readForm,
  readInterview,
  readMandate,
  recordPath,
  workRecordMarkdown,
  type FormValues,
  type Identity,
  type Site,
  type TimelineEntry,
  type TimelineFilter,
  type TimelineResponse,
} from "@accelerator/domain";
import { createHash } from "node:crypto";

import { CodeError } from "./codes";
import { record } from "./ledger";
import { db, rows, type Row } from "./supabase";

/**
 * The Library on the server (gen2-crew.md §3, G2.5): the Site Timeline over
 * the ledger, the Boarding interview (a versioned document), each Work item's
 * record for the /docs sync (T5), and the export bundle.
 */

const PAGE = 100;

/** The Site Timeline, newest first, a page at a time (`before` is the last id seen). */
export async function timeline(site: Site, opts: { before?: number | null; filter?: TimelineFilter; work?: number | null } = {}): Promise<TimelineResponse> {
  const work = await rows(db().from("acc_work").select("id, number, title").eq("site_id", site.id));
  const byId = new Map(work.map((w) => [w.id as string, { number: w.number as number, title: w.title as string }]));
  let q = db().from("acc_ledger").select("*").eq("site_id", site.id);
  if (opts.before) q = q.lt("id", opts.before);
  if (opts.work != null) {
    const w = work.find((x) => x.number === opts.work);
    if (!w) throw new CodeError("That work item doesn't exist.");
    q = q.eq("work_id", w.id as string);
  }
  const list = await rows(q.order("id", { ascending: false }).limit(PAGE + 1));
  const entries: TimelineEntry[] = list.slice(0, PAGE).map((e) => ({
    id: Number(e.id), at: e.at as string, kind: e.kind as string, actorKind: e.actor_kind as TimelineEntry["actorKind"], actor: e.actor_label as string,
    summary: e.summary as string, counts: !!e.counts, work: e.work_id ? (byId.get(e.work_id as string) ?? null) : null, refs: (e.refs as Record<string, unknown>) ?? {},
  }));
  return { entries, next: list.length > PAGE ? entries.at(-1)!.id : null, filter: opts.filter ?? "all" };
}

// ── The Boarding interview: a versioned site document (kind requirements) ────
const INTERVIEW_TITLE = "Site interview";

async function interviewDoc(siteId: string) {
  const [doc] = await rows(db().from("acc_documents").select("*").eq("site_id", siteId).eq("kind", "requirements").eq("title", INTERVIEW_TITLE).is("work_id", null).limit(1));
  return doc ?? null;
}

export async function siteInterview(siteId: string): Promise<{ values: FormValues; version: number; at: string; by: string } | null> {
  const doc = await interviewDoc(siteId);
  if (!doc) return null;
  const [v] = await rows(db().from("acc_document_versions").select("version, body, author_label, created_at").eq("document_id", doc.id as string).order("version", { ascending: false }).limit(1));
  const values = v ? readInterview(v.body as string) : null;
  return v && values ? { values, version: v.version as number, at: v.created_at as string, by: v.author_label as string } : null;
}

export async function saveInterview(site: Site, identity: Identity, name: string, input: unknown) {
  const values = readForm(INTERVIEW_FORM, input);
  const body = interviewMarkdown(values);
  let doc = await interviewDoc(site.id);
  if (!doc) {
    const { data, error } = await db().from("acc_documents").insert({ org_id: site.orgId, site_id: site.id, work_id: null, kind: "requirements", title: INTERVIEW_TITLE }).select("*").single();
    if (error) throw new Error(error.message);
    doc = data as Row;
  }
  const [top] = await rows(db().from("acc_document_versions").select("version").eq("document_id", doc.id as string).order("version", { ascending: false }).limit(1));
  const version = ((top?.version as number) ?? 0) + 1;
  const { error } = await db().from("acc_document_versions").insert({
    document_id: doc.id, org_id: site.orgId, site_id: site.id, version, body, sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body),
    author_kind: "person", author_label: name, approved_at: new Date().toISOString(), approved_by: identity.userId,
  });
  if (error) throw new Error(error.message);
  await db().from("acc_documents").update({ updated_at: new Date().toISOString() }).eq("id", doc.id as string);
  await record({ org_id: site.orgId, site_id: site.id, id: null }, { kind: "interview", actor: { kind: "person", userId: identity.userId, label: name }, summary: `Site interview v${version} saved.`, refs: { document: doc.id, version } });
  return { version };
}

// ── The Work item record (T5) ────────────────────────────────────────────────
/** The Markdown the Librarian writes at Prove, built from the records (never from the model's report). */
export async function workRecord(siteName: string, w: Row): Promise<{ path: string; body: string }> {
  const [docs, steps, decisions, evidence, mandates] = await Promise.all([
    rows(db().from("acc_work_docs").select("version, body, approved_at").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1)),
    rows(db().from("acc_work_steps").select("position, title, status").eq("work_id", w.id as string).order("position")),
    rows(db().from("acc_decisions").select("created_at, kind, actor_label, via, target, invalidated_reason").eq("work_id", w.id as string).order("created_at")),
    rows(db().from("acc_evidence").select("created_at, kind, ok, commit_sha, passed, total").eq("work_id", w.id as string).neq("kind", "census").order("created_at")),
    rows(db().from("acc_mandates").select("*").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1)),
  ]);
  const complexity = isComplexity(w.complexity) ? w.complexity : "medium";
  const m = mandates[0];
  const body = workRecordMarkdown({
    site: siteName,
    work: { number: w.number as number, title: w.title as string, complexity, stage: w.stage as string, branch: (w.branch as string) ?? null },
    mandate: m ? { ...readMandate(m.body), version: m.version as number, createdBy: m.created_label as string, createdAt: m.created_at as string } : null,
    document: docs[0] ? { kind: complexity === "medium" ? "brief" : "design", version: docs[0].version as number, body: docs[0].body as string, approvedAt: (docs[0].approved_at as string) ?? null } : null,
    steps: steps.map((s) => ({ position: s.position as number, title: s.title as string, status: s.status as string })),
    decisions: decisions.map((d) => ({ at: d.created_at as string, kind: d.kind as string, by: d.actor_label as string, via: (d.via as string) ?? null, target: (d.target as string) ?? null, voided: (d.invalidated_reason as string) ?? null })),
    evidence: evidence.map((e) => ({ at: e.created_at as string, kind: e.kind as string, ok: !!e.ok, commit: (e.commit_sha as string) ?? null, tests: e.total == null ? null : `${e.passed}/${e.total}` })),
  });
  return { path: recordPath(w.number as number), body };
}

// ── Export (§2.4: Library and export) ───────────────────────────────────────
const LIMIT = 20_000;

/**
 * Everything the site's record holds, as one JSON document: decisions,
 * documents with versions, evidence, the ledger, mandates, capabilities,
 * skills and proposals. Secrets never; the vault lists names only.
 */
export async function exportSite(site: Site, by: string) {
  const sid = site.id;
  const [work, decisions, evidence, ledger, documents, versions, mandates, capabilities, capabilityWork, skills, proposals, crew, archives, vault] = await Promise.all([
    rows(db().from("acc_work").select("id, number, kind, title, stage, complexity, risk, branch, created_at, released_at").eq("site_id", sid).order("number")),
    rows(db().from("acc_decisions").select("*").eq("site_id", sid).order("created_at").limit(LIMIT)),
    rows(db().from("acc_evidence").select("*").eq("site_id", sid).order("created_at").limit(LIMIT)),
    rows(db().from("acc_ledger").select("*").eq("site_id", sid).order("id").limit(LIMIT)),
    rows(db().from("acc_documents").select("*").eq("site_id", sid)),
    rows(db().from("acc_document_versions").select("id, document_id, version, body, sha256, bytes, author_kind, author_label, model, approved_at, pruned_at, created_at").eq("site_id", sid).limit(LIMIT)),
    rows(db().from("acc_mandates").select("*").eq("site_id", sid)),
    rows(db().from("acc_capabilities").select("*").eq("site_id", sid)),
    rows(db().from("acc_capability_work").select("*").eq("site_id", sid)),
    rows(db().from("acc_skills").select("id, scope, name, version, body, specialists, enabled, updated_at").eq("site_id", sid)),
    rows(db().from("acc_skill_proposals").select("*").eq("site_id", sid)),
    rows(db().from("acc_crew_versions").select("version, config, note, created_label, created_at").eq("site_id", sid).order("version")),
    rows(db().from("acc_log_archives").select("job_id, storage_key, events, bytes, archived_at, deleted_at").eq("site_id", sid)),
    rows(db().from("acc_secrets").select("environment, name, updated_at").eq("site_id", sid)),
  ]);
  const tables = { work, decisions, evidence, ledger, documents, document_versions: versions, mandates, capabilities, capability_work: capabilityWork, skills, skill_proposals: proposals, crew_versions: crew, log_archives: archives,
    // Names only: a value, or its ciphertext, never leaves the vault.
    vault_names: vault.map((v) => ({ environment: v.environment, name: v.name, updated_at: v.updated_at })) };
  const at = new Date().toISOString();
  return { manifest: exportManifest({ site: { slug: site.slug, name: site.name, url: site.url }, at, by, tables }), ...tables };
}
