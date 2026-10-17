-- Traceability store step T1 (gen2-crew.md §21.6, D48) and the crew's own repairs and pause (§17.4, F2).
-- T1: decisions, evidence and the ledger are written alongside today's columns (dual write); the
-- *_approved_at columns stay as a cache until the backfill (T2) makes these records authoritative.
-- Additive and re-runnable. Run before deploying the code that writes them.

-- ── Decisions: append-only; voiding one sets invalidated_at and the reason, never deletes ──────────
create table if not exists acc_decisions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references acc_orgs(id) on delete cascade,
  site_id             uuid not null references acc_sites(id) on delete cascade,
  work_id             uuid references acc_work(id) on delete cascade,
  kind                text not null,          -- approve_brief · approve_design · approve_plan · approve_try · ship · release · close · cancel · tier · auto_ship · begin · pause · resume
  actor_kind          text not null check (actor_kind in ('person','policy')),
  actor_user_id       uuid,                   -- null for a policy decision
  actor_label         text not null,          -- "Patrick" · "Low-complexity policy"
  actor_role          text,                   -- owner · operator · …
  via                 text,                   -- button · typed · policy
  target              text,                   -- "brief v2" · "design v3" · candidate commit · tier
  detail              jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  invalidated_at      timestamptz,
  invalidated_reason  text
);
create index if not exists acc_decisions_work on acc_decisions (work_id, created_at);
create index if not exists acc_decisions_site on acc_decisions (site_id, created_at);

-- ── Evidence: one row per check run, bound to the exact candidate ───────────────────────────────
create table if not exists acc_evidence (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  site_id     uuid not null references acc_sites(id) on delete cascade,
  work_id     uuid references acc_work(id) on delete cascade,
  job_id      uuid references acc_jobs(id) on delete set null,
  step_id     uuid references acc_work_steps(id) on delete set null,
  kind        text not null,                  -- step_checks · prove · release
  commit_sha  text,
  ok          boolean not null,
  passed      integer,
  failed      integer,
  total       integer,
  detail      jsonb not null default '{}',    -- reasons, build, preview, live check
  created_at  timestamptz not null default now()
);
create index if not exists acc_evidence_work on acc_evidence (work_id, created_at);
create index if not exists acc_evidence_site on acc_evidence (site_id, created_at);

-- ── The Change Ledger / Site Timeline: everything that happened on a site, in order ──────────────
create table if not exists acc_ledger (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  work_id      uuid references acc_work(id) on delete cascade,
  at           timestamptz not null default now(),
  kind         text not null,                 -- decision · evidence · step_built · drafted · assessed · escalated · repair · paused · …
  actor_kind   text not null check (actor_kind in ('person','crew','policy','system')),
  actor_label  text not null,                 -- a person's name, a crew role ("Builder"), or the policy
  summary      text not null,
  counts       boolean not null default false, -- an evidence-backed contribution (the contribution graph, §21.5)
  refs         jsonb not null default '{}'    -- decision, evidence, step, job, commit, document version
);
create index if not exists acc_ledger_site on acc_ledger (site_id, at);
create index if not exists acc_ledger_work on acc_ledger (work_id, at);

-- ── The crew's own repairs (bounded) and pause from the conversation ────────────────────────────
alter table acc_work_steps add column if not exists attempts      integer not null default 0;
alter table acc_work       add column if not exists proof_repairs integer not null default 0;
alter table acc_work       add column if not exists paused_at     timestamptz;

do $$
declare t text;
begin
  foreach t in array array['acc_decisions','acc_evidence','acc_ledger']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
