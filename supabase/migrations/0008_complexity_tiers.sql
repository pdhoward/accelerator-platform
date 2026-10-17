-- Complexity tiers and the TDD plane (gen2-crew.md §17, D41–D44), plus each site's domain (§20, D47).
-- A Work item's tier decides which decisions the client makes: Low ships through the TDD plane with
-- none, Medium needs the Brief and Ship it, High keeps the full gates. Protected risk (money, data,
-- auth, security) is always High; the API enforces that floor.
-- The cadence column is retired (no longer read or written) and kept for history; drop it later.
-- Additive and re-runnable.

alter table acc_work add column if not exists complexity             text not null default 'medium';
alter table acc_work add column if not exists recommended_complexity text;          -- the Team Lead's rating
alter table acc_work add column if not exists complexity_reason      text;          -- why, in one sentence
alter table acc_work add column if not exists complexity_set_by      text not null default 'platform';
alter table acc_work add column if not exists ready_at               timestamptz;   -- the lead understood it well enough to start
alter table acc_work add column if not exists auto_ship              boolean not null default false; -- Medium: ship when proof is green

alter table acc_work drop constraint if exists acc_work_complexity_check;
alter table acc_work add constraint acc_work_complexity_check check (complexity in ('low','medium','high'));
alter table acc_work drop constraint if exists acc_work_recommended_complexity_check;
alter table acc_work add constraint acc_work_recommended_complexity_check
  check (recommended_complexity is null or recommended_complexity in ('low','medium','high'));
alter table acc_work drop constraint if exists acc_work_complexity_set_by_check;
alter table acc_work add constraint acc_work_complexity_set_by_check check (complexity_set_by in ('platform','person'));

-- Items already past their governing approvals keep today's behavior: anything with protected risk is High.
update acc_work set complexity = 'high'
 where complexity <> 'high' and risk && array['money','data','auth','security']::text[];

-- The domain pack a site's crew is configured for (commerce, hospitality, ...). Null until chosen in Configuration.
alter table acc_sites add column if not exists domain text;
alter table acc_sites drop constraint if exists acc_sites_domain_check;
alter table acc_sites add constraint acc_sites_domain_check check (domain is null or domain in ('commerce','hospitality'));
