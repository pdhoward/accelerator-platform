-- Gen 3, the Cradle (accelerator/work/gen3-cradle.md §2.5): a site's policy graph, and the ingest job
-- that reads a site's code into it. Additive and re-runnable. Run on accelerator-test BEFORE deploying
-- the code that uses it.
--
-- The industry packs (ontology, starter policies, kernels, components) live in code
-- (packages/domain/src/cradle-packs.ts). The database holds only the site's layer: what it adopts,
-- overrides or adds, every version of it, the contradictions found and the steward's rulings.

create extension if not exists btree_gist;

-- ── One cradle per site: which pack it started from ───────────────────────────────────────────
create table if not exists acc_cradles (
  site_id        uuid primary key references acc_sites(id) on delete cascade,
  org_id         uuid not null references acc_orgs(id) on delete cascade,
  pack           text not null check (pack in ('commerce','hospitality')),
  pack_version   text not null,
  started_by     uuid,
  started_label  text,
  started_at     timestamptz not null default now(),
  ingested_at    timestamptz
);

-- ── Nodes: the site's policies (and, later, decisions), every version kept ──────────────────────
-- A key (C-SHIP-1, S-CHECKO-1) is stable across versions. "effective" is half-open, so a new version
-- starts the moment the old one ends; the exclusion constraint guarantees exactly one version of a
-- key is in force at any instant ("the rules at booking apply" is an exact query).
create table if not exists acc_cradle_nodes (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references acc_orgs(id) on delete cascade,
  site_id            uuid not null references acc_sites(id) on delete cascade,
  kind               text not null default 'policy' check (kind in ('policy','decision')),
  key                text not null,
  version            integer not null,
  effective          tstzrange not null default tstzrange(now(), null, '[)'),
  criticality        text check (criticality in ('critical','important','routine')),
  binding            text check (binding in ('adopted','overridden','site')),
  extraction_status  text check (extraction_status in ('candidate','source_verified','unsupported')),
  business_status    text check (business_status in ('unreviewed','confirmed','disputed','retired')),
  body               jsonb not null default '{}',   -- the SitePolicy (or decision) itself
  search             tsvector generated always as (to_tsvector('english', coalesce(body->>'title','') || ' ' || coalesce(body->>'statement',''))) stored,
  created_by         uuid,
  created_label      text,
  created_at         timestamptz not null default now(),
  unique (site_id, key, version),
  exclude using gist (site_id with =, key with =, effective with &&)
);
-- The current book (the hot path) and "as of" lookups.
create index if not exists acc_cradle_nodes_current on acc_cradle_nodes (site_id, kind) where upper_inf(effective);
create index if not exists acc_cradle_nodes_effective on acc_cradle_nodes using gist (site_id, effective);
create index if not exists acc_cradle_nodes_body on acc_cradle_nodes using gin (body jsonb_path_ops);
create index if not exists acc_cradle_nodes_search on acc_cradle_nodes using gin (search);

-- ── Edges: contradictions now; implements / expresses / derives_from as the graph grows ──────────
create table if not exists acc_cradle_edges (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references acc_orgs(id) on delete cascade,
  site_id        uuid not null references acc_sites(id) on delete cascade,
  kind           text not null check (kind in ('conflicts_with','implements','expresses','derives_from','supersedes','depends_on')),
  src_key        text not null,
  dst_key        text not null,
  status         text not null default 'open' check (status in ('open','resolved')),
  body           jsonb not null default '{}',   -- { keys, why, kind, ruling, ruledBy, ruledAt }
  effective      tstzrange not null default tstzrange(now(), null, '[)'),
  created_at     timestamptz not null default now()
);
-- Walking both ways: what does this touch, and what touches this.
create index if not exists acc_cradle_edges_src on acc_cradle_edges (site_id, src_key, kind);
create index if not exists acc_cradle_edges_dst on acc_cradle_edges (site_id, dst_key, kind);

-- ── The ingest job: site-level, like checkout ──────────────────────────────────────────────────
alter table acc_jobs drop constraint if exists acc_jobs_kind_check;
alter table acc_jobs add constraint acc_jobs_kind_check
  check (kind in ('discuss','design','plan','build_step','checkout','prove','release','ingest'));

do $$
declare t text;
begin
  foreach t in array array['acc_cradles','acc_cradle_nodes','acc_cradle_edges']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
