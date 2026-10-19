-- Stage 2 and Stage 3 (gen2-crew.md §17–§21, §14, §1.2): one agent session per Work item, reliable
-- job claims, the Toolbelt's audit, documents with versions, retention and log archives, and the
-- backfill of decisions, evidence and the ledger (traceability T2/T3). Additive and re-runnable.
-- Run on accelerator-test BEFORE deploying the code that uses it.

-- ── F4: one agent session per Work item (the runner resumes it instead of cold-starting) ─────────
alter table acc_work add column if not exists agent_session_id text;

-- ── §14 reliable execution: expiring claims, a generation per claim, bounded attempts ───────────
alter table acc_jobs add column if not exists claim_expires_at timestamptz;
alter table acc_jobs add column if not exists generation      integer not null default 0;
alter table acc_jobs add column if not exists attempts        integer not null default 0;
alter table acc_jobs add column if not exists outcome_unknown boolean not null default false;
create index if not exists acc_jobs_running on acc_jobs (status, claim_expires_at);

-- ── G2.2 Toolbelt: one audit row per tool call (§1.2 change 4) ──────────────────────────────────
create table if not exists acc_tool_calls (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  site_id     uuid not null references acc_sites(id) on delete cascade,
  work_id     uuid references acc_work(id) on delete cascade,
  job_id      uuid references acc_jobs(id) on delete set null,
  role        text not null,               -- the specialist's model setting (consult · design · plan · build · judge)
  tool        text not null,
  input       jsonb not null default '{}', -- a redacted summary, never secrets
  ok          boolean not null,
  result      text,                        -- a short summary or the refusal
  ms          integer,
  created_at  timestamptz not null default now()
);
create index if not exists acc_tool_calls_site on acc_tool_calls (site_id, created_at);
create index if not exists acc_tool_calls_job on acc_tool_calls (job_id);

-- ── T3: documents with identity and versions (§21.3) ────────────────────────────────────────────
create table if not exists acc_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  site_id     uuid not null references acc_sites(id) on delete cascade,
  work_id     uuid references acc_work(id) on delete cascade,
  kind        text not null check (kind in ('brief','design','plan','decision','requirements','rulebook','receipt')),
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists acc_documents_work_kind on acc_documents (work_id, kind) where work_id is not null;

create table if not exists acc_document_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references acc_documents(id) on delete cascade,
  org_id        uuid not null references acc_orgs(id) on delete cascade,
  site_id       uuid not null references acc_sites(id) on delete cascade,
  version       integer not null,
  body          text,                      -- inline; null once pruned or moved to storage
  storage_key   text,                      -- object storage, for large or archived bodies
  sha256        text not null,
  bytes         integer not null,
  author_kind   text not null check (author_kind in ('person','model','system')),
  author_label  text not null,
  model         text,
  approved_at   timestamptz,
  approved_by   uuid,
  pruned_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (document_id, version)
);

-- ── T4: retention settings (per company) and log archives (§21.4) ──────────────────────────────
create table if not exists acc_retention (
  org_id                    uuid primary key references acc_orgs(id) on delete cascade,
  drafts_kept               integer not null default 10  check (drafts_kept between 1 and 1000),
  logs_hot_days             integer not null default 30  check (logs_hot_days between 1 and 3650),
  logs_retention_days       integer not null default 365 check (logs_retention_days between 1 and 3650),
  artifacts_retention_days  integer not null default 365 check (artifacts_retention_days between 1 and 3650),
  updated_at                timestamptz not null default now()
);

create table if not exists acc_log_archives (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  job_id       uuid not null unique references acc_jobs(id) on delete cascade,
  storage_key  text not null,
  events       integer not null,
  bytes        integer not null,
  archived_at  timestamptz not null default now(),
  deleted_at   timestamptz
);

-- The private bucket for archived logs; paths are org/<org>/site/<site>/… (§3.3).
insert into storage.buckets (id, name, public) values ('accelerator-logs', 'accelerator-logs', false) on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['acc_tool_calls','acc_documents','acc_document_versions','acc_retention','acc_log_archives']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ── T2: backfill decisions, evidence and the ledger for Work recorded before T1 ────────────────
-- Only items with no T1 records yet; every row is marked reconstructed.
insert into acc_decisions (org_id, site_id, work_id, kind, actor_kind, actor_user_id, actor_label, via, target, detail, created_at)
select w.org_id, w.site_id, w.id, 'approve_design', 'person', d.approved_by, 'Recorded before decisions were kept', 'button',
       'design v' || d.version, jsonb_build_object('reconstructed', true), d.approved_at
  from acc_work w join acc_work_docs d on d.work_id = w.id
 where d.approved_at is not null
   and not exists (select 1 from acc_decisions x where x.work_id = w.id
                   and (not coalesce((x.detail->>'reconstructed')::boolean, false) or (x.kind = 'approve_design' and x.target = 'design v' || d.version)));

insert into acc_decisions (org_id, site_id, work_id, kind, actor_kind, actor_user_id, actor_label, via, target, detail, created_at)
select w.org_id, w.site_id, w.id, k.kind, case when k.who is null then 'policy' else 'person' end, k.who,
       case when k.who is null then 'Policy (reconstructed)' else 'Recorded before decisions were kept' end,
       case when k.who is null then 'policy' else 'button' end, k.target, jsonb_build_object('reconstructed', true), k.at
  from acc_work w
  cross join lateral (values
    ('approve_plan', w.plan_approved_at, w.plan_approved_by, null::text),
    ('approve_try',  w.try_approved_at,  w.try_approved_by,  w.proof->>'commit'),
    ('release',      w.released_at,      null::uuid,         w.release->>'mainCommit')
  ) as k(kind, at, who, target)
 where k.at is not null
   and not exists (select 1 from acc_decisions x where x.work_id = w.id
                   and (not coalesce((x.detail->>'reconstructed')::boolean, false) or x.kind = k.kind));

insert into acc_evidence (org_id, site_id, work_id, step_id, kind, commit_sha, ok, passed, failed, total, detail, created_at)
select w.org_id, w.site_id, w.id, s.id, 'step_checks', s.evidence->>'commit', s.status = 'done',
       (s.evidence->'checks'->'tests'->>'passed')::int, (s.evidence->'checks'->'tests'->>'failed')::int, (s.evidence->'checks'->'tests'->>'total')::int,
       jsonb_build_object('reconstructed', true, 'reasons', coalesce(s.evidence->'reasons', '[]'::jsonb)), s.updated_at
  from acc_work w join acc_work_steps s on s.work_id = w.id
 where s.status in ('done','blocked') and s.evidence ? 'checks'
   and not exists (select 1 from acc_evidence x where x.work_id = w.id);

insert into acc_evidence (org_id, site_id, work_id, kind, commit_sha, ok, passed, failed, total, detail, created_at)
select w.org_id, w.site_id, w.id, 'prove', w.proof->>'commit', coalesce((w.proof->>'ok')::boolean, false),
       (w.proof->'tests'->>'passed')::int, (w.proof->'tests'->>'failed')::int, (w.proof->'tests'->>'total')::int,
       jsonb_build_object('reconstructed', true, 'reasons', coalesce(w.proof->'reasons', '[]'::jsonb)), coalesce((w.proof->>'at')::timestamptz, w.updated_at)
  from acc_work w
 where w.proof is not null and not exists (select 1 from acc_evidence x where x.work_id = w.id and x.kind = 'prove');

insert into acc_evidence (org_id, site_id, work_id, kind, commit_sha, ok, detail, created_at)
select w.org_id, w.site_id, w.id, 'release', w.release->>'mainCommit', coalesce((w.release->>'ok')::boolean, false),
       jsonb_build_object('reconstructed', true, 'liveUrl', w.release->>'liveUrl', 'liveStatus', w.release->>'liveStatus'), coalesce((w.release->>'at')::timestamptz, w.updated_at)
  from acc_work w
 where w.release is not null and not exists (select 1 from acc_evidence x where x.work_id = w.id and x.kind = 'release');

insert into acc_ledger (org_id, site_id, work_id, at, kind, actor_kind, actor_label, summary, counts, refs)
select e.org_id, e.site_id, e.work_id, e.created_at, e.kind,
       'crew',
       case when e.kind = 'release' then 'Release' else 'Builder' end,
       case e.kind when 'step_checks' then 'Step checked (reconstructed)' when 'prove' then 'Prove (reconstructed)' else 'Release (reconstructed)' end,
       e.ok, jsonb_build_object('evidence', e.id, 'reconstructed', true)
  from acc_evidence e
 where coalesce((e.detail->>'reconstructed')::boolean, false)
   and not exists (select 1 from acc_ledger l where l.refs->>'evidence' = e.id::text);

insert into acc_ledger (org_id, site_id, work_id, at, kind, actor_kind, actor_label, summary, counts, refs)
select d.org_id, d.site_id, d.work_id, d.created_at, 'decision', d.actor_kind, d.actor_label,
       replace(d.kind, '_', ' ') || ' (reconstructed)', true, jsonb_build_object('decision', d.id, 'reconstructed', true)
  from acc_decisions d
 where coalesce((d.detail->>'reconstructed')::boolean, false)
   and not exists (select 1 from acc_ledger l where l.refs->>'decision' = d.id::text);

-- ── T3 backfill: every existing design version becomes a document version ──────────────────────
insert into acc_documents (org_id, site_id, work_id, kind, title, created_at, updated_at)
select distinct on (w.id) w.org_id, w.site_id, w.id, case when w.complexity = 'medium' then 'brief' else 'design' end, w.title, min(d.created_at) over (partition by w.id), now()
  from acc_work w join acc_work_docs d on d.work_id = w.id
on conflict (work_id, kind) where work_id is not null do nothing;

insert into acc_document_versions (document_id, org_id, site_id, version, body, sha256, bytes, author_kind, author_label, model, approved_at, approved_by, created_at)
select doc.id, d.org_id, w.site_id, d.version, d.body, encode(sha256(convert_to(d.body, 'UTF8')), 'hex'), octet_length(d.body),
       case when d.model is null then 'person' else 'model' end, d.author_label, d.model, d.approved_at, d.approved_by, d.created_at
  from acc_work_docs d join acc_work w on w.id = d.work_id join acc_documents doc on doc.work_id = w.id
on conflict (document_id, version) do nothing;
