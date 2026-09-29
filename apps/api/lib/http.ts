import { NextResponse } from "next/server";
import { canPlatform, canSite, type Caller, type Identity, type PlatformAction, type Site, type SiteAction } from "@accelerator/domain";
import type { ZodType } from "zod";

import { resolveIdentity } from "./auth";
import { CodeError } from "./codes";
import { store } from "./store";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Parses a JSON body with a zod schema; null on bad input. */
export async function body<T>(request: Request, schema: ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** One error policy for every route: user-facing CodeErrors → 400, the rest → 500. */
async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof CodeError) return fail(err.message, 400);
    console.error(err);
    return fail("Something went wrong on our side.", 500);
  }
}

type Ctx<P> = { params: Promise<P> };

/** Anyone (sign-in endpoints). */
export function publicRoute<P = object>(handler: (ctx: { request: Request; params: P }) => Promise<Response>) {
  return (request: Request, context: Ctx<P>) => guarded(async () => handler({ request, params: await context.params }));
}

/** Any signed-in person. */
export function identityRoute<P = object>(handler: (ctx: { request: Request; identity: Identity; params: P }) => Promise<Response>) {
  return (request: Request, context: Ctx<P>) =>
    guarded(async () => {
      const identity = await resolveIdentity(request);
      if (!identity) return fail("Sign in first.", 401);
      return handler({ request, identity, params: await context.params });
    });
}

/** Platform staff holding `action` (permissions.ts). */
export function platformRoute<P = object>(
  action: PlatformAction,
  handler: (ctx: { request: Request; identity: Identity; params: P }) => Promise<Response>,
) {
  return identityRoute<P>(async (ctx) => (canPlatform(ctx.identity.platformRole, action) ? handler(ctx) : fail("Not allowed.", 403)));
}

/**
 * A site the caller belongs to, with their role checked against `action`.
 * Another tenant's site is a 404 (existence not disclosed); a suspended
 * account is a 423.
 */
export function siteRoute<P extends { siteId: string } = { siteId: string }>(
  handler: (ctx: { request: Request; identity: Identity; caller: Caller; site: Site; params: P }) => Promise<Response>,
  action: SiteAction = "site.view",
) {
  return identityRoute<P>(async ({ request, identity, params }) => {
    const access = await store.access(identity, params.siteId);
    if (!access) return fail("Site not found.", 404);
    if (access.status === "suspended") return fail("This account is suspended. Contact Strategic Machines.", 423);
    if (!canSite(access.caller.role, action)) return fail("Your role can't do that here.", 403);
    return handler({ request, identity, caller: access.caller, site: access.site, params });
  });
}
