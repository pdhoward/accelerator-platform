import {
  buildBriefing,
  buildStudio,
  type BriefingResponse,
  type Site,
  type StudioResponse,
} from "@accelerator/domain";
import { demoMode } from "./auth";
import { CodeError } from "./codes";
import { studioSample } from "./studio-sample";
import { listWork, workDetail } from "./work";

/** Read current Work records for an already-authorized site; synthetic only in keyless demo. */
export async function readBriefing(site: Site): Promise<BriefingResponse> {
  const sample = demoMode();
  if (sample && !site.demo)
    throw new CodeError("Live Work records require the database.");
  const items = sample ? [studioSample().work] : await listWork(site.id);
  return {
    ...buildBriefing(items),
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
  if (sample && (!site.demo || number !== 1))
    throw new CodeError("That sample work item does not exist.");
  const detail = sample ? studioSample() : await workDetail(site, number);
  return {
    detail,
    studio: buildStudio(detail, {
      source: sample ? "sample" : "recorded",
      observedAt: new Date().toISOString(),
    }),
  };
}
