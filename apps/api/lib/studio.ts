import {
  buildBriefing,
  buildStudio,
  type BriefingResponse,
  type Site,
  type StudioResponse,
} from "@accelerator/domain";
import { demoMode } from "./auth";
import { CodeError } from "./codes";
import { sampleItems, studioSample } from "./studio-sample";
import { listWork, pendingDecisions, workDetail } from "./work";

/** Read current Work records for an already-authorized site; synthetic only in keyless demo. */
export async function readBriefing(site: Site): Promise<BriefingResponse> {
  const sample = demoMode();
  if (sample && !site.demo)
    throw new CodeError("Live Work records require the database.");
  const samples = sample ? sampleItems() : [];
  const items = sample ? samples.map((d) => d.work) : await listWork(site.id);
  const briefing = buildBriefing(items);
  // Review points come from the same decision rules as the conversation and the Cockpit Dial.
  briefing.decisions = sample
    ? samples.filter((d) => d.decision).sort((x, y) => x.work.number - y.work.number).map((d) => ({ number: d.work.number, title: d.decision!.title, detail: d.work.title }))
    : (await pendingDecisions(items)).map((p) => ({ number: p.number, title: p.title, detail: p.work }));
  return {
    ...briefing,
    source: sample ? "sample" : "recorded",
    observedAt: new Date().toISOString(),
    siteName: site.name,
  };
}
/** Compose the authorized Work detail and its read-only evidence projection. */
export async function readStudio(
  site: Site,
  number: number,
): Promise<StudioResponse> {
  if (!Number.isSafeInteger(number) || number < 1)
    throw new CodeError("Invalid work number.");
  const sample = demoMode();
  if (sample && (!site.demo || !sampleItems().some((d) => d.work.number === number)))
    throw new CodeError("That sample work item does not exist.");
  const detail = sample ? studioSample(number) : await workDetail(site, number);
  return {
    detail,
    studio: buildStudio(detail, {
      source: sample ? "sample" : "recorded",
      observedAt: new Date().toISOString(),
    }),
  };
}
