import { formErrors, readForm, SKILL_FORM } from "@accelerator/domain";

import { listProposals, proposeSkill } from "@/lib/crew";
import { fail, json, workRoute } from "@/lib/http";

/** Skill proposals: from the Skillsmith's evidence, and from people (gen2-crew.md §2.1). */
export const GET = workRoute(async ({ site }) => json(await listProposals(site.id)));

/** Anyone who works on the site can propose a skill; only the Owner's side activates one. */
export const POST = workRoute(async ({ request, identity, caller, site }) => {
  const values = readForm(SKILL_FORM, await request.json().catch(() => null));
  const errors = formErrors(SKILL_FORM, values);
  if (Object.keys(errors).length) return fail(Object.values(errors).join(" "), 400);
  return json(await proposeSkill(site, identity, caller.name, {
    title: String(values.title), body: String(values.body), specialist: String(values.specialist), scope: values.scope === "org" ? "org" : "site",
  }));
}, "request.create");
