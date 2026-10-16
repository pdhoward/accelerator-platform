# Executive workspace: first implementation slice

Implemented locally 2026-10-15 following Owner authorization. Foundation: `../accelerator/work/gen2-crew.md` sections 10, 13–15. No database migration, live agent job, deployment or production transaction is part of this change.

## Review surface

- Site Overview (`/s/<site>`) is Executive Briefing, derived from `acc_work` rather than legacy request/demo trends. No toast-only approval, deployment or undo controls remain on this page.
- Existing `/s/<site>/work/<number>` is Delivery Studio. Conversation, artifact editing and all existing API action/gate behavior are retained. Mission Control and Proof Lab are alternate lenses over the same record; switching retains drafts and selected artifacts.
- Crew activity maps existing job kinds to advisory role labels. This is not yet the configurable Gen 2 specialist catalog. Job model settings are shown, without claiming each job called that model. No arbitrary model switching or cost/token estimates.
- Replay freezes the available activity snapshot on opening, with explicit start/pause/restart/step/seek/speed controls. Playback is read-only, does not issue jobs or approvals, and does not overwrite incoming live state. Arrival animations reflect a recorded event; reduced-motion media preferences suppress them. Live activity polling is paused in hidden tabs; visual-motion controls do not imply stopping a job.
- Proof Lab compiles an evidence-derived receipt, ties checks to a candidate, rejects zero-test proof, and flags evidence superseded by later build/design/plan activity. It does not grant release authority.

## Architecture

`packages/domain/src/studio.ts` owns typed read models and pure projections, including event ordering/deduplication and bounded replay selection. `apps/api/lib/studio.ts` reads through existing Work functions; `siteRoute` authorizes both new GET endpoints. `packages/api-client` supplies the sole typed transport. `apps/console/components/workspace` contains reusable presentation components. Existing mutation endpoints and domain gate rules remain the authority.

GET `/api/sites/:site/briefing` and `/api/sites/:site/work/:number/studio` return private no-store projections. Route parameters are only lookup selectors: the access boundary resolves the permitted Site, and data reads use that resolved identity. Authentication, tenant denial and suspended-account behavior are tested. The new endpoints expose no mutations. Studio approval/release controls also hide for partner/support access; the API still independently enforces authority.

With no database credentials, the existing local demo receives synthetic read-only Work fixtures, explicitly marked `sample`. A database-backed site never receives those fixtures, even if its site record has a demo flag. Demo UI mutation controls are disabled. The existing keyless fixture retains its historical Cypress label; it is not a connection to Cypress production. Browser QA uses only these local fixtures, never the Cypress repository, deployment or database.

## Validation

- `pnpm typecheck`: all workspaces; passed.
- `pnpm test`: 96 passing domain, API and runner tests, including 29 new projection/permission/access-explanation tests.
- `pnpm build`: API and console production builds; the existing Google Fonts dependency needs network access.
- `pnpm exec playwright install chromium` once; then `pnpm qa:workspace` for retained browser QA.

Browser QA starts isolated keyless servers on ports 4100/4101 with `.next-qa` output, bypassing neither authentication nor tenant policy for live data. It clears known Supabase/runner credential variables in its child processes and does not load envmachine. Existing developer servers on 4000/4001 are left alone. Screenshots and logs go to ignored `.qa-artifacts`. 26 browser assertions passed. Assertions cover sample labels, disabled execution, refresh outage/recovery, artifact preservation, lenses, replay playback/step/pause/keyboard seek/restart, reduced-motion layouts at 320/390/768/1440, reload, no browser exceptions and no mutating API requests. These are synthetic UI/API checks, not proof of live delivery or provider execution.

## Remaining stages / review attention

- Replay is reconstructed from retained job boundaries, design approvals and proof snapshots: latest 20 jobs and first 400 events of the newest job. Coverage is visible; no full historical artifact playback or private reasoning is claimed. Add paginated structured event history and immutable artifact references in a later persistence stage.
- Current schemas omit plan/Try approval timestamps, complete business-journey QA, provider usage/cost receipts, recovery rehearsal and stabilization records. They remain explicitly unverified/unavailable.
- Missing run lease/checkpoint/outcome-reconciliation protocols from section 14 are still implementation backlog, not delivered by this UI slice. All protected actions continue using the existing runner/API; do not expand agent autonomy before those protocols are proven.
- Capability inventory, mandate records, specialist catalog, Toolbelt and evaluated harness learning remain subsequent phases.
- Live sign-in, migration 0007 status and the 10-Work Machine Shop Prove/Try/Release exercise still require the separately planned verification. Review database compatibility before deployment.
- The broader legacy navigation remains available during migration. Four-screen consolidation should follow the replacement of each underlying view, rather than hiding working features prematurely.
- Root lint is not configured in the existing monorepo; this change adds reproducible formatting and retains compiler/test/build checks rather than claiming a lint pass.

## Contextual access correction

The Studio now explains unavailable decisions at the current gate and shows the resolved access route/account role across all lenses. Partner/support access, read-only account roles, protected preview approval and release permission limits have separate messages. Direct client members retain existing authority; platform administrator status is not a client approval bypass. Ten domain cases exercise these explanations. No memberships or live account roles were changed.

## Independent Work closure and next improvements (2026-10-16)

Delivery Studio exposes Start another improvement independently of the current lifecycle. Idle pre-release Work can be closed using Close without platform release; recorded released Work uses Close completed work. The former retains the existing internal `cancelled` status and is not counted as verified delivery. It does not deploy, revert, delete branches or erase completed steps/proof. This corrects the former misleading Close without building label and audit wording. Historical messages are retained unchanged.

The current task is never closed automatically by this implementation. Closing still needs the existing authorized API action and explicit user confirmation; active jobs must finish first. Failed database updates no longer produce a successful closure response/message. Terminal records are read-only for new conversations/design changes, and released designs cannot silently reopen under old approvals. Start a fresh Work item for new scope; it receives its own design/plan approvals. Consultant instructions now explain these exact paths rather than guessing a send-back button or requiring an unnecessary release.

Local release status is not inferred from an agent's chat or from manual Git activity. If code reached main outside the platform, closing tracking does not manufacture a platform release receipt. The separate release-reconciliation feature remains future work.
