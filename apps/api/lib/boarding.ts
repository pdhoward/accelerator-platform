import { boardingProgress, isBoardingStep, type Boarding, type BoardingStepId, type Identity, type Site } from "@accelerator/domain";

import { CodeError } from "./codes";
import { crewConfig } from "./crew";
import { record } from "./ledger";
import { siteInterview } from "./library";
import { db, rows } from "./supabase";
import { siteSetup } from "./work";

/**
 * Boarding on the server (gen2-crew.md §2.5, G2.6): the facts for each step
 * come from the records (setup items, census evidence, capabilities, the
 * interview, the crew, releases, the Agreement); packages/domain decides the
 * state. Interventions are ledger entries kind "intervention".
 */

export async function readBoarding(site: Site): Promise<Boarding> {
  const [setup, census, health, caps, interview, crew, released, interventions] = await Promise.all([
    siteSetup(site),
    rows(db().from("acc_evidence").select("created_at").eq("site_id", site.id).eq("kind", "census").order("created_at", { ascending: false }).limit(1)),
    rows(db().from("acc_health_snapshots").select("id").eq("site_id", site.id).limit(1)),
    rows(db().from("acc_capabilities").select("lifecycle").eq("site_id", site.id)),
    siteInterview(site.id),
    crewConfig(site.id),
    rows(db().from("acc_work").select("id").eq("site_id", site.id).eq("kind", "change").not("released_at", "is", null).limit(1)),
    rows(db().from("acc_ledger").select("at, summary, actor_label, refs").eq("site_id", site.id).eq("kind", "intervention").order("at", { ascending: false }).limit(50)),
  ]);
  const items = Object.fromEntries(setup.items.map((i) => [i.code, i.status]));
  return boardingProgress(
    {
      scanned: health.length > 0 || census.length > 0,
      repo: !!setup.settings.repo,
      repoPath: !!setup.settings.repoPath,
      items,
      censusAt: (census[0]?.created_at as string) ?? null,
      capabilities: { proposed: caps.filter((c) => c.lifecycle === "proposed").length, accepted: caps.filter((c) => c.lifecycle === "accepted").length },
      domain: !!setup.settings.domain,
      interviewAt: interview?.at ?? null,
      crewVersion: crew.version,
      baselineTests: setup.settings.baselineTests,
      released: released.length,
      agreementSigned: !!setup.agreement?.signedAt,
    },
    interventions.map((e) => ({ at: e.at as string, step: String((e.refs as Record<string, unknown>)?.step ?? ""), note: e.summary as string, by: e.actor_label as string })),
  );
}

/**
 * A point where a person had to step in during Boarding. Each one is logged
 * and becomes a backlog item for the Boarding crew (Machine Shop goes first).
 */
export async function logIntervention(site: Site, identity: Identity, name: string, step: string, note: string) {
  if (!isBoardingStep(step)) throw new CodeError("Pick the Boarding step it happened in.");
  const text = note.trim();
  if (text.length < 5) throw new CodeError("Say what had to be done by hand.");
  await record({ org_id: site.orgId, site_id: site.id, id: null }, {
    kind: "intervention", actor: { kind: "person", userId: identity.userId, label: name }, summary: text.slice(0, 500), refs: { step: step as BoardingStepId },
  });
}
