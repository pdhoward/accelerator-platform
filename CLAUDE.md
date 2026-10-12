# Accelerator Platform — working rules

The product behind strategicmachines.ai: the **Control Room** a site owner uses to run their
website, and the API and agents behind it. Design docs live in `machine/accelerator/work/`; the
current direction is **`newvision.md`**. **`gen2-crew.md` is the approved Gen 2 foundation that all
refactoring and database work executes from:** its §0 foundation rules, §4.5 build order and §8 action
list. **When a doc and the code disagree, the code wins**, and the doc is fixed in the same change.

**Test site: Machine Shop** (`machine/machineshop`). Prove every capability there first. **Never point
the runner, a crew or any test at Cypress Resort (`ts-platform`)**: it is live production serving
real guests.

## The one rule
All business logic and all data access live in **`apps/api`**, backed by pure functions in
**`packages/domain`**. `apps/console` (and every future app) is a thin client that talks to the
API only through **`packages/api-client`**. Never read or write the database from a client app.
(The same rule that kept Customer Zero, `ts-platform`, correct: logic implemented in two places
drifts, and the copies end up disagreeing.) Everything else here follows from that rule.

## Layout
| Path | What it is |
|---|---|
| `apps/api` | The API server (Next.js route handlers, port 4001). Resolves the caller and tenant, owns the only DB access. |
| `apps/console` | The Control Room (Next.js 16 + Tailwind 4, port 4000). One Control Room per site. |
| `apps/runner` | Agent runtime (sandboxes, git, tests). Long-running, not Vercel functions. Talks to `apps/api` over its runner routes. |
| `packages/domain` | Pure types and rules: loop stages, risk classes, **gate policy**, permissions, metrics. Zero runtime deps. Tested. |
| `packages/api-client` | The one typed wrapper over the API. Never duplicate it. |
| `packages/config` | Shared tsconfig. |

Planned: `ops` (internal mission control across tenants). A prospect **demo** is a tenant, not an app.

## Architecture & layering
```
clients (thin)        apps/console · [future apps]          apps/runner
      │  only via packages/api-client                         │ runner routes
apps/api              THE PRODUCT: resolves caller + tenant, enforces permissions, owns the only DB client
      │
packages/domain       pure rules and types, unit-tested
      │
Supabase (Postgres/Auth, RLS on every table)
```
- **Two layers must never be duplicated:** `packages/api-client` (one SDK) and `packages/domain`
  (one implementation of each rule). If you need a rule in a second place, import it; don't copy it.
- **Domain computes, the API executes.** `packages/domain` takes plain data and returns plain data:
  no `fetch`, no Supabase, no SDK calls, no `process.env`, and `"dependencies": {}` stays empty.
  The domain decides *what* should happen; an `apps/api` route decides *whether* the caller may,
  and then does the I/O.
- **Every API route goes through a wrapper in `apps/api/lib/http.ts`** (`publicRoute`,
  `identityRoute`, `platformRoute`, `siteRoute`, `workRoute`, `runnerRoute`). The wrapper resolves
  the caller and checks the permission. Validate request bodies with zod via `body()`. Don't
  hand-roll auth in a route.
- **Data access goes through `store`** (`apps/api/lib/store.ts`), which picks the Supabase or the
  in-memory implementation behind one `AcceleratorStore` interface. A new data operation goes on
  that interface and is implemented in **both** `store-supabase.ts` and `store-memory.ts`.
- **`apps/api/lib/supabase.ts` `db()` is the only service-role client** (it bypasses RLS). Never add
  a second one. In the console, Supabase is used **only** for auth/session (cookies), never for data.

## Tenancy
Platform → **Partner** → Organization (company) → Sites → Members (Owner · Operator · Tester · Viewer).
- A **site** is the unit: its own crew, rulebook, configuration (env manifest), connections, skills,
  test suites, metrics and meters.
- Every organization belongs to exactly one **partner**. Strategic Machines' direct clients belong to
  the **house partner**, which has no special code path.
- **Platform powers are infrastructure only.** Platform staff reach a client only through an
  explicit, audited support grant, never through a standing bypass (gen2-crew.md §5; phase G2.0b
  removes the staff bypass that `store.access()` still has today).
- Partner and platform staff never hold a client's gates.
- `org_id` (and partner) always comes from the caller's credential, never from client input.
- RLS is on every table (`supabase/migrations`).
- Until Supabase is configured, `apps/api/lib/store.ts` serves a seeded in-memory demo tenant.
- Skills come in four tiers: platform, partner, company, site.

## Product rules
- **Gates are deterministic policy** (`packages/domain/src/gates.ts`). Models classify; policy decides
  what needs a human. Money, data, auth and security changes always need an Owner.
- **No vector embeddings.** Context comes from the Library and the long-context models, assembled per task.
- **Secrets never enter the repo, prompts or logs.** The Configuration page records *which* keys a
  site needs and whether each environment has them, never the values.

## Engineering principles
- **Keep it simple.** Write the smallest change that solves the problem. Don't add abstractions,
  options or layers for hypothetical future needs; add them when a second real use appears.
- **DRY.** One home for each rule, type and helper. Before writing something new, search
  `packages/domain`, `apps/api/lib` and `apps/console/lib` for an existing version and reuse or
  extend it.
- **Componentize.** Build console UI from small, focused, reusable components. Shared pieces live in
  one place and are imported, never copied between pages. Pages compose components; they don't hold
  business logic.
- **Config, not code.** Behaviour that varies per site (keys, rules, thresholds, skills) is data
  that an Owner edits, not a constant that needs a deploy.
- **Comment the why.** Give each exported function, component and route a short doc comment saying
  what it is for. Comment non-obvious decisions, invariants and gotchas inline. Don't narrate
  obvious code. Match the comment style already in the file.
- **Fail clearly.** Return actionable errors (`fail("Pick a cadence.", 400)`), not bare 500s. Never
  swallow an error silently.
- **Types are the contract.** Shared types live in `packages/domain` and are imported by the API,
  the api-client and the clients. No `any` across a package boundary.

## Testing
- **Run `pnpm typecheck && pnpm test` before every merge**, not just risky ones. Both must pass.
- Tests are vitest, co-located as `*.test.ts` next to the code (`packages/domain/src`,
  `apps/api/lib`, `apps/runner/src`).
- **Every new or changed rule in `packages/domain` ships with tests.** Gates, permissions and the
  flywheel are pure functions, so test them exhaustively: each risk class, each role, each edge.
- Test behaviour, not just "it ran." Assert exact values against fixtures. Against real config,
  assert invariants.
- Never "fix" a failing test by weakening the assertion, skipping it, or running as a superuser that
  bypasses RLS. Fix the code, or explain why the test was wrong.
- Suites that need live secrets should skip cleanly without them; that's expected, not a failure.

## Shipping
- **Work on `main` and push to production** (decision D15, 2026-10-12: two developers, the owner and
  Claude). `main` is production, and Vercel deploys every push. There's no `stage` branch until a
  second contributor or the first paying client. Client sites the crew manages keep the full
  `work/<n>` → preview → `stage` → `main` path.
- Turbo 2.x (`turbo.json` uses `tasks`): packages build and typecheck before the apps that depend on them.
- No CI by decision (D15): **run `pnpm typecheck && pnpm test` locally before every push.** That is the only gate, so never skip it.

## Always / Never

**Always**
- Put business logic in `apps/api` + `packages/domain`; call it from clients via `packages/api-client`.
- Derive `org_id` / site access from the caller's credential, never from client input.
- Wrap every API route in an `http.ts` route wrapper; validate input with zod.
- Add new data operations to the `AcceleratorStore` interface and both stores.
- Reuse before you write: search for an existing helper, type or component first.
- Keep components small and shared pieces in one place.
- Write a doc comment on exports and a comment on anything non-obvious.
- Add tests with every domain rule change.
- Run `pnpm typecheck && pnpm test` before every push to `main`.

**Never**
- Read or write the database from `apps/console` or any client app (Supabase there is auth only).
- Duplicate `packages/api-client` or a domain rule, or put I/O (`fetch`/Supabase/SDKs/env) in `packages/domain`.
- Add a second service-role client.
- Let a model decide what needs a human; gate policy decides.
- Put a secret value in the repo, a prompt, a log or the Configuration page.
- Add vector embeddings.
- Weaken or skip a failing test to get green.
- Push to `main` with a failing typecheck or test, or trust a design doc over the code.
