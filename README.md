# Accelerator Platform

The product behind [strategicmachines.ai](https://strategicmachines.ai): the **Control Room** a site owner
uses to run their website, and the API and agents behind it. Design:
`cypress-actions/accelerator-control-room.md`. Working rules: [CLAUDE.md](CLAUDE.md).

## Apps and packages

| | Port | |
|---|---|---|
| `apps/console` | 4000 | The Control Room (Next.js 16, Tailwind 4) |
| `apps/api` | 4001 | The API server — all logic and data access |
| `packages/domain` | | Types, gate policy, loop, metrics (pure, tested) |
| `packages/api-client` | | The one typed client every app uses |

## Run it

```bash
pnpm install
pnpm dev          # console on http://localhost:4000, API on http://localhost:4001
pnpm typecheck
pnpm test
```

Keys live in `envmachine/accelerator-platform/development/.env.development.local` and are
injected by `startup-accelerate.bat` on the Desktop (dotenv-cli), one terminal per app. With no keys, the API serves a seeded demo tenant (Cypress Resort, Customer Zero) from memory,
and the Health page's **Run Lighthouse** needs `PAGESPEED_API_KEY`.

Database schema (multi-tenant, RLS): `supabase/migrations/0001_init.sql`.
