import {
  budgetState,
  mandateChanges,
  mandateErrors,
  mandateFromDocument,
  mandateVoids,
  readMandate,
  type Identity,
  type Mandate,
  type MandateBody,
  type Site,
} from "@accelerator/domain";

import { CodeError } from "./codes";
import { decide, invalidate } from "./ledger";
import { db, rows, type Row } from "./supabase";

/**
 * Versioned mandates (gen2-crew.md §10.1). A revision is a person's decision
 * on the ledger; when it changes what is built or how it is accepted, it voids
 * the approvals made on the old terms. Jobs record the version they ran under.
 */

const toMandate = (r: Row): Mandate => ({ ...readMandate(r.body), version: r.version as number, createdBy: r.created_label as string, createdAt: r.created_at as string });

export async function currentMandate(workId: string): Promise<Mandate | null> {
  const [top] = await rows(db().from("acc_mandates").select("*").eq("work_id", workId).order("version", { ascending: false }).limit(1));
  return top ? toMandate(top) : null;
}

export async function mandateHistory(workId: string): Promise<Mandate[]> {
  return (await rows(db().from("acc_mandates").select("*").eq("work_id", workId).order("version", { ascending: false }).limit(20))).map(toMandate);
}

/** Model spend on one Work item so far, from the jobs' recorded cost. */
export async function spentOn(workId: string): Promise<number> {
  const jobs = await rows(db().from("acc_jobs").select("cost_usd").eq("work_id", workId));
  return jobs.reduce((sum, j) => sum + (Number(j.cost_usd) || 0), 0);
}

async function workOf(siteId: string, number: number): Promise<Row> {
  const [w] = await rows(db().from("acc_work").select("*").eq("site_id", siteId).eq("number", number));
  if (!w) throw new CodeError("That work item doesn't exist.");
  return w;
}

export async function saveMandate(site: Site, identity: Identity, name: string, number: number, input: unknown): Promise<Mandate> {
  const w = await workOf(site.id, number);
  if (w.stage === "done" || w.stage === "cancelled") throw new CodeError("This item is closed; its mandate is part of the record now.");
  const body: MandateBody = readMandate(input);
  const errors = mandateErrors(body);
  if (errors.length) throw new CodeError(errors.join(" "));
  const before = await currentMandate(w.id as string);
  const changes = mandateChanges(before, body);
  if (before && !changes.length) return before;
  const version = (before?.version ?? 0) + 1;
  const { data, error } = await db()
    .from("acc_mandates")
    .insert({ org_id: site.orgId, site_id: site.id, work_id: w.id, version, body, created_by: identity.userId, created_label: name })
    .select("*")
    .single();
  if (error) throw new CodeError(error.message.includes("duplicate") ? "Someone changed the mandate a moment ago. Reload and try again." : error.message);
  await decide(w, {
    kind: "mandate", actor: { kind: "person", userId: identity.userId, label: name }, target: `mandate v${version}`,
    summary: before ? `Mandate v${version} for #${w.number}: ${changes.map((c) => c.label).join(", ")} changed.` : `Mandate v1 set for #${w.number}.`,
    detail: { changes: changes.map((c) => c.field) },
  });
  const voids = mandateVoids(changes);
  if (before && voids.length) await invalidate(w, voids, `the mandate changed (v${version}: ${changes.map((c) => c.label).join(", ")})`);
  return toMandate(data as Row);
}

/** A first mandate drafted from the approved Brief or design, for a person to confirm (never saved by itself). */
export async function draftMandate(site: Site, number: number): Promise<MandateBody> {
  const w = await workOf(site.id, number);
  const [doc] = await rows(db().from("acc_work_docs").select("body, approved_at").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1));
  const draft = doc ? mandateFromDocument(doc.body as string) : readMandate({});
  return { ...draft, outcome: draft.outcome || (w.title as string) };
}

export async function budgetFor(workId: string) {
  const [m, spent] = await Promise.all([currentMandate(workId), spentOn(workId)]);
  return budgetState(m, spent);
}
