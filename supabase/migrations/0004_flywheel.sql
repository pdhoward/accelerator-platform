-- The Flywheel (work/flywheel.md v0.3): Work items on one rail, the thread,
-- design versions, the plan, runner jobs + live log, the Setup checklist,
-- the Agreement, and the model chosen for each job.
-- Additive. API-only tables: RLS on, no policies (service role).

-- ── Sites: where the runner works (local path until the GitHub App) ────────
alter table acc_sites add column if not exists repo_path text;          -- local working copy (development)
alter table acc_sites add column if not exists base_branch text not null default 'stage';
alter table acc_sites add column if not exists stage_url text;          -- the fixed staging URL
alter table acc_sites add column if not exists baseline_tests integer;  -- from checkout C1; the suite may not shrink below it

-- ── Work items ───────────────────────────────────────────────────────────────
create table if not exists acc_work (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references acc_orgs(id) on delete cascade,
  site_id           uuid not null references acc_sites(id) on delete cascade,
  number            integer not null,
  title             text not null,
  stage             text not null default 'discuss'
                    check (stage in ('discuss','design','plan','build','prove','try','release','learn','done','cancelled')),
  cadence           text not null default 'every_step' check (cadence in ('every_step','at_risk','run')),
  risk              text[] not null default '{}',
  navigator_id      uuid,                      -- auth user steering it
  branch            text,                      -- work/<n>-<slug>
  plan_approved_at  timestamptz,
  plan_approved_by  uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (site_id, number)
);
create index if not exists acc_work_site_stage on acc_work (site_id, stage);

-- The thread: people, models and the system, across every stage.
create table if not exists acc_work_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references acc_orgs(id) on delete cascade,
  work_id         uuid not null references acc_work(id) on delete cascade,
  author_kind     text not null check (author_kind in ('person','model','system')),
  author_user_id  uuid,
  author_label    text not null,               -- "Patrick" · "Claude Opus 5.5" · "Runner"
  model           text,                        -- provider/model for model messages
  stage           text not null,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists acc_work_messages_thread on acc_work_messages (work_id, created_at);

-- design.md versions; approval is per version.
create table if not exists acc_work_docs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references acc_orgs(id) on delete cascade,
  work_id       uuid not null references acc_work(id) on delete cascade,
  version       integer not null,
  body          text not null,
  author_label  text not null,
  model         text,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (work_id, version)
);

-- The plan.
create table if not exists acc_work_steps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  work_id     uuid not null references acc_work(id) on delete cascade,
  position    integer not null,
  title       text not null,
  detail      text not null default '',
  status      text not null default 'todo' check (status in ('todo','running','done','blocked','skipped')),
  evidence    jsonb not null default '{}',     -- checks, tests before/after, commit, files, summary
  updated_at  timestamptz not null default now()
);
create index if not exists acc_work_steps_plan on acc_work_steps (work_id, position);

-- ── Runner ───────────────────────────────────────────────────────────────────
create table if not exists acc_jobs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  work_id      uuid references acc_work(id) on delete cascade,
  kind         text not null check (kind in ('discuss','design','plan','build_step','checkout')),
  status       text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  role         text not null,                  -- which model setting it uses (consult · design · plan · build · judge)
  provider     text not null,
  model        text not null,
  input        jsonb not null default '{}',
  result       jsonb,
  error        text,
  runner_id    text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists acc_jobs_queue on acc_jobs (status, created_at);
create index if not exists acc_jobs_work on acc_jobs (work_id, created_at desc);

create table if not exists acc_job_events (
  id      bigint generated always as identity primary key,
  job_id  uuid not null references acc_jobs(id) on delete cascade,
  at      timestamptz not null default now(),
  kind    text not null check (kind in ('log','tool','check','status')),
  text    text not null,
  data    jsonb
);
create index if not exists acc_job_events_job on acc_job_events (job_id, id);

create table if not exists acc_runners (
  id         text primary key,                 -- host name + pid
  last_seen  timestamptz not null default now(),
  version    text
);

-- ── Setup: Install · Checkout · Agreement ────────────────────────────────────
create table if not exists acc_setup_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  site_id     uuid not null references acc_sites(id) on delete cascade,
  code        text not null,                   -- I1…I8, C1…C7
  phase       text not null check (phase in ('install','checkout')),
  title       text not null,
  owner       text not null check (owner in ('strategic_machines','engine','client')),
  status      text not null default 'todo' check (status in ('todo','waiting','done','failed','not_needed')),
  note        text,
  evidence    jsonb not null default '{}',
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (site_id, code)
);

create table if not exists acc_agreements (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  site_id     uuid not null references acc_sites(id) on delete cascade,
  version     integer not null,
  body        text not null,
  signed_by   uuid,
  signed_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (site_id, version)
);

-- ── The model for each job, per site (F15) ───────────────────────────────────
create table if not exists acc_site_models (
  site_id     uuid not null references acc_sites(id) on delete cascade,
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  role        text not null check (role in ('consult','design','plan','build','judge')),
  provider    text not null check (provider in ('anthropic','openai','xai','google')),
  model       text not null,
  key_source  text not null default 'ours' check (key_source in ('ours','customer')),
  updated_at  timestamptz not null default now(),
  primary key (site_id, role)
);

do $$
declare t text;
begin
  foreach t in array array['acc_work','acc_work_messages','acc_work_docs','acc_work_steps','acc_jobs',
    'acc_job_events','acc_runners','acc_setup_items','acc_agreements','acc_site_models']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
