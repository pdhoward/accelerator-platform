import { fail, json, runnerRoute } from "@/lib/http";
import { db } from "@/lib/supabase";
import { secretValues } from "@/lib/vault";

/** Development keys for a running job's site. Never preview-only or production values. */
export const POST = runnerRoute<{ jobId: string }>(async ({ params }) => {
  const { data: job } = await db().from("acc_jobs").select("site_id, status").eq("id", params.jobId).maybeSingle();
  if (!job || job.status !== "running") return fail("That job isn't running.", 404);
  return json({ env: await secretValues(job.site_id as string, "development") });
});
