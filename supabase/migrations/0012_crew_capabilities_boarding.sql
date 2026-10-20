-- Stage 4 and Stage 5 (gen2-crew.md §2, §10, §20, G2.3–G2.6): the crew as configuration, skill tiers,
-- versioned mandates, the capability inventory, Skillsmith proposals, cost per job and the /docs sync
-- switch. Additive and re-runnable. Run on accelerator-test BEFORE deploying the code that uses it.
--
-- The crew catalog and the crew and domain skill tiers live in code (packages/domain/src/crew.ts),
-- versioned and reviewed in git. The database holds what changes per tenant: partner, company and
-- site skills, each site's crew settings (versioned), mandates, capabilities and proposals.

-- ── Skill tiers (§2.2, §20): partner · org · site rows; legacy rows keep scope null and stay out of prompts
alter table acc_skills add column if not exists scope       text check (scope in ('partner','org','site'));
alter table acc_skills add column if not exists partner_id  uuid references acc_partners(id) on delete cascade;
alter table acc_skills add column if not exists specialists text[] not null default '{}';  -- empty = every specialist
alter table acc_skills add column if not exists created_by  uuid;
alter table acc_skills add column if not exists updated_at  timestamptz not null default now();
create index if not exists acc_skills_scope on acc_skills (scope, org_id, site_id);

-- ── The site's crew, versioned (§2.1): every change is a new version; the highest is live ─────────
create table if not exists acc_crew_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references acc_orgs(id) on delete cascade,
  site_id        uuid not null references acc_sites(id) on delete cascade,
  version        integer not null,
  config         jsonb not null,           -- { specialists: { id: { enabled, tools? } }, disabledSkills: [] }
  note           text,
  created_by     uuid,
  created_label  text not null,
  created_at     timestamptz not null default now(),
  unique (site_id, version)
);

-- ── Mandates (§10.1): what a Work item is authorized to do, versioned; every job names its version ─
create table if not exists acc_mandates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references acc_orgs(id) on delete cascade,
  site_id        uuid not null references acc_sites(id) on delete cascade,
  work_id        uuid not null references acc_work(id) on delete cascade,
  version        integer not null,
  body           jsonb not null,           -- outcome, scope, out of scope, acceptance, budget, due, invariants, decision owners, review
  created_by     uuid,
  created_label  text not null,
  created_at     timestamptz not null default now(),
  unique (work_id, version)
);

alter table acc_jobs add column if not exists mandate_version integer;
alter table acc_jobs add column if not exists crew_version    integer;
alter table acc_jobs add column if not exists cost_usd        numeric(10,4);

-- ── The capability inventory (§10.3, G2.3a): proposed by the Survey, accepted by a person ──────────
create table if not exists acc_capabilities (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references acc_orgs(id) on delete cascade,
  site_id         uuid not null references acc_sites(id) on delete cascade,
  key             text not null,           -- stable identity; a rename keeps it
  area            text not null,           -- business area ("Catalog")
  name            text not null,
  purpose         text not null default '',
  lifecycle       text not null default 'proposed' check (lifecycle in ('proposed','accepted','retired')),
  importance      text not null default 'standard' check (importance in ('critical','standard','supporting')),
  accountable     text not null default 'lead',
  paths           text[] not null default '{}',   -- technical links: path patterns in the repository
  requirements    jsonb not null default '[]',    -- [{ text, acceptance }]
  version         integer not null default 1,
  source          text not null default 'person' check (source in ('survey','template','person')),
  confidence      numeric(3,2),
  evidence        jsonb not null default '{}',    -- what the proposal was based on (matched files, template)
  reviewed_by     uuid,
  reviewed_label  text,
  reviewed_at     timestamptz,
  retired_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (site_id, key)
);

create table if not exists acc_capability_work (
  capability_id  uuid not null references acc_capabilities(id) on delete cascade,
  work_id        uuid not null references acc_work(id) on delete cascade,
  org_id         uuid not null references acc_orgs(id) on delete cascade,
  site_id        uuid not null references acc_sites(id) on delete cascade,
  via            text not null default 'files' check (via in ('files','person')),
  files          text[] not null default '{}',
  created_at     timestamptz not null default now(),
  primary key (capability_id, work_id)
);
create index if not exists acc_capability_work_work on acc_capability_work (work_id);

-- ── Skillsmith proposals (§2.1): arrive disabled, approved by the tier owner, reversible ───────────
create table if not exists acc_skill_proposals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references acc_orgs(id) on delete cascade,
  site_id        uuid not null references acc_sites(id) on delete cascade,
  kind           text not null check (kind in ('new','edit','retire')),
  skill_id       uuid references acc_skills(id) on delete set null,
  scope          text not null default 'site' check (scope in ('org','site')),
  title          text not null,
  body           text not null,
  previous_body  text,
  specialists    text[] not null default '{}',
  rationale      text not null,
  evidence       jsonb not null default '{}',
  source         text not null default 'skillsmith' check (source in ('skillsmith','person')),
  rule           text,                     -- which Skillsmith rule produced it (one open proposal per rule)
  status         text not null default 'proposed' check (status in ('proposed','approved','rejected','rolled_back')),
  evaluation     text not null default 'not evaluated',
  decided_by     uuid,
  decided_label  text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists acc_skill_proposals_site on acc_skill_proposals (site_id, status, created_at);

-- ── T5: approved decisions written into the client's repository at Prove (docs/accelerator/) ──────
alter table acc_sites add column if not exists docs_sync boolean not null default true;

do $$
declare t text;
begin
  foreach t in array array['acc_crew_versions','acc_mandates','acc_capabilities','acc_capability_work','acc_skill_proposals']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
