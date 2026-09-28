-- Accelerator platform — control-plane schema (multi-tenant).
-- Every tenant-owned row carries org_id; RLS limits each member to their org.
-- org_id and role are stamped onto the JWT at sign-in (the ts-platform
-- custom access token hook pattern) and read here via auth.jwt().
-- Documents and conversations use jsonb; files (screenshots, attachments)
-- live in Supabase Storage, keyed by org/site. No vector embeddings.

create extension if not exists pgcrypto;

create table acc_orgs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  plan         text not null default 'operate' check (plan in ('commission','operate','managed')),
  created_at   timestamptz not null default now()
);

create table acc_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  user_id      uuid not null,               -- auth.users.id
  name         text not null,
  role         text not null check (role in ('owner','operator','tester','viewer')),
  created_at   timestamptz not null default now(),
  unique (org_id, user_id)
);

create table acc_sites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  slug         text not null,
  name         text not null,
  url          text not null,
  repo         text not null,               -- owner/name on GitHub
  stack        text,
  status       text not null default 'onboarding' check (status in ('onboarding','live')),
  created_at   timestamptz not null default now(),
  unique (org_id, slug)
);

create table acc_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  number       integer not null,            -- permanent, per site (the backlog.md convention)
  title        text not null,
  detail       text,
  type         text not null,
  risk         text[] not null default '{}',
  priority     text not null default 'next' check (priority in ('now','next','later')),
  stage        text not null default 'new',
  source       text,
  created_by   uuid references acc_members(id),
  created_at   timestamptz not null default now(),
  unique (site_id, number)
);

create table acc_changes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  request_id   uuid references acc_requests(id),
  title        text not null,
  stage        text not null default 'clarify',
  risk         text[] not null default '{}',
  level        text not null default 'AC2' check (level in ('AC1','AC2','AC3')),
  summary      text,
  conversation jsonb not null default '[]',
  evidence     jsonb not null default '[]',
  checklist    jsonb not null default '[]',
  engineer     jsonb not null default '{}',  -- PR, branch, files, preview URL, models
  created_at   timestamptz not null default now()
);

create table acc_approvals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  change_id    uuid not null references acc_changes(id) on delete cascade,
  member_id    uuid not null references acc_members(id),
  role         text not null,
  gate         text not null check (gate in ('try','owner-approval','data-preview')),
  checked      text[] not null default '{}',
  created_at   timestamptz not null default now()
);

create table acc_releases (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  change_id    uuid references acc_changes(id),
  title        text not null,
  notes        text,
  deployment   text,                        -- Vercel deployment id, for undo
  released_at  timestamptz not null default now()
);

create table acc_docs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  kind         text not null check (kind in ('rulebook','decision','design','requirements','runbook','release-notes')),
  title        text not null,
  status       text not null default 'draft',
  repo_path    text,                        -- the markdown file in git is the source of truth
  body         text not null default '',
  updated_at   timestamptz not null default now()
);

create table acc_consultations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  title        text not null,
  mode         text not null check (mode in ('voice','meeting','chat')),
  stage        text not null default 'transcript',
  transcript   jsonb not null default '[]',
  requirements jsonb not null default '[]',
  open_questions jsonb not null default '[]',
  doc_id       uuid references acc_docs(id),
  held_at      timestamptz not null default now()
);

create table acc_test_runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  change_id    uuid references acc_changes(id),
  verdict      text not null check (verdict in ('ready','needs-work')),
  suites       jsonb not null default '[]',  -- per-layer results
  ran_at       timestamptz not null default now()
);

create table acc_health_snapshots (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  kind         text not null check (kind in ('lighthouse','architecture')),
  data         jsonb not null,
  taken_at     timestamptz not null default now()
);

-- The env manifest: which keys a site needs, per environment. NEVER values.
-- Values live in the secrets vault (encrypted) and are injected only into
-- sandboxes and deploy targets.
create table acc_env_specs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  key          text not null,
  service      text not null,
  purpose      text not null,
  secret       boolean not null default true,
  required_by  text[] not null default '{}',
  status       jsonb not null default '{"development":"missing","preview":"missing","production":"missing"}',
  how_to_get   text,
  last_verified timestamptz,
  unique (site_id, key)
);

create table acc_skills (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references acc_orgs(id) on delete cascade,  -- null = Strategic Machines library
  site_id      uuid references acc_sites(id) on delete cascade,
  name         text not null,
  category     text not null,
  description  text not null,
  version      text not null,
  body         text not null,               -- the skill's instructions
  enabled      boolean not null default true
);

create table acc_usage (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid references acc_sites(id) on delete set null,
  provider     text not null,
  model        text not null,
  role         text not null,
  tokens_in    bigint not null default 0,
  tokens_out   bigint not null default 0,
  cost_usd     numeric(12,4) not null default 0,
  at           timestamptz not null default now()
);

create table acc_limits (
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  model        text not null,               -- '*' = daily cap across all models
  limit_usd    numeric(12,2) not null,
  period       text not null check (period in ('day','month')),
  primary key (org_id, model, period)
);

create index on acc_requests (site_id, stage);
create index on acc_changes (site_id, stage);
create index on acc_usage (org_id, at desc);
create index on acc_health_snapshots (site_id, kind, taken_at desc);

-- ── Row-level security: members see only their org ─────────────────────────
create or replace function acc_org_id() returns uuid
  language sql stable as $$ select nullif(auth.jwt() ->> 'org_id', '')::uuid $$;

do $$
declare t text;
begin
  foreach t in array array['acc_members','acc_sites','acc_requests','acc_changes','acc_approvals',
    'acc_releases','acc_docs','acc_consultations','acc_test_runs','acc_health_snapshots',
    'acc_env_specs','acc_usage','acc_limits']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (org_id = acc_org_id())', t || '_org_read', t);
  end loop;
end $$;

alter table acc_orgs enable row level security;
create policy acc_orgs_read on acc_orgs for select to authenticated using (id = acc_org_id());

alter table acc_skills enable row level security;
create policy acc_skills_read on acc_skills for select to authenticated
  using (org_id is null or org_id = acc_org_id());

-- Writes go through apps/api (service role) only, where role + gate policy
-- are enforced. No insert/update/delete policies for authenticated users.
