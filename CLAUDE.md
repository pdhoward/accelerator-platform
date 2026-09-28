# Accelerator Platform — working rules

The product behind strategicmachines.ai: the **Control Room** a site owner uses to run their
website, and the API and agents behind it. Design source of truth:
`cypress-actions/accelerator-control-room.md`.

## The one rule
All business logic and all data access live in **`apps/api`**, backed by pure functions in
**`packages/domain`**. `apps/console` (and every future app) is a thin client that talks to the
API only through **`packages/api-client`**. Never read or write the database from a client app.
(The same rule that kept Customer Zero, `ts-platform`, correct.)

## Layout
| Path | What it is |
|---|---|
| `apps/api` | The API server (Next.js route handlers, port 4001). Resolves the caller and tenant, owns the only DB access. |
| `apps/console` | The Control Room (Next.js 16 + Tailwind 4, port 4000). One Control Room per site. |
| `packages/domain` | Pure types and rules: loop stages, risk classes, **gate policy**, metrics. Zero runtime deps. Tested. |
| `packages/api-client` | The one typed wrapper over the API. Never duplicate it. |
| `packages/config` | Shared tsconfig. |

Planned apps: `runner` (agent runtime: sandboxes, git, tests; long-running, not Vercel functions),
`ops` (internal mission control across tenants). A prospect **demo** is a tenant, not an app.

## Tenancy
Organization → Sites → Members (Owner · Operator · Tester · Viewer). A **site** is the unit: its own
rulebook, configuration (env manifest), connections, skills, test suites, metrics and meters.
`org_id` always comes from the caller's credential, never from client input. RLS on every table
(`supabase/migrations`). Until Supabase is configured, `apps/api/lib/store.ts` serves a seeded
in-memory demo tenant (Cypress Resort, Customer Zero).

## Rules
- **Gates are deterministic policy** (`packages/domain/src/gates.ts`). Models classify; policy decides
  what needs a human. Money, data, auth and security changes always need an Owner.
- **No vector embeddings.** Context comes from the Library and the long-context models, assembled per task.
- Secrets never enter the repo, prompts or logs. The Configuration page records *which* keys a site
  needs and whether each environment has them — never the values.
- Run `pnpm typecheck && pnpm test` before merging. Branch off `stage`; never commit to `main`.
