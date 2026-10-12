-- Partners: multi-tenant and multi-vendor (machine/accelerator/work/gen2-crew.md §5, phase G2.0b).
-- 1. Tenancy becomes Platform → Partner → Company (acc_orgs) → Site. Every company has exactly
--    one partner. Strategic Machines' direct clients belong to the house partner.
-- 2. Partner staff (acc_partner_members) operate their own partner's companies, never the gates.
-- 3. Platform staff no longer reach every account. Access to a company outside the house
--    partner needs an explicit, time-boxed, audited support grant (acc_support_grants).
-- 4. Audit rows carry the partner, so a partner can later see what happened to its clients.
-- Additive and re-runnable. API-only tables: RLS on, no policies (service role).

create table if not exists acc_partners (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  kind        text not null default 'partner' check (kind in ('house','partner')),
  tier        text check (tier in ('silver','gold','platinum')),
  status      text not null default 'active' check (status in ('active','suspended')),
  brand       jsonb not null default '{}'::jsonb,  -- crewName, logoUrl, colors, domain (Platinum)
  created_at  timestamptz not null default now()
);
-- Exactly one house partner.
create unique index if not exists acc_partners_one_house on acc_partners (kind) where kind = 'house';

insert into acc_partners (slug, name, kind, brand)
values ('strategic-machines', 'Strategic Machines', 'house', '{"crewName": "Strategic Machines"}'::jsonb)
on conflict (slug) do nothing;

-- Every company belongs to one partner; existing companies are the house partner's.
alter table acc_orgs add column if not exists partner_id uuid references acc_partners(id);
update acc_orgs set partner_id = (select id from acc_partners where kind = 'house') where partner_id is null;
alter table acc_orgs alter column partner_id set not null;
create index if not exists acc_orgs_partner on acc_orgs (partner_id);

-- A partner's own team. user_id is filled when the person first signs in (seat claimed by email).
create table if not exists acc_partner_members (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references acc_partners(id) on delete cascade,
  user_id     uuid,
  email       text not null,
  name        text not null default '',
  role        text not null check (role in ('owner','admin','operator')),
  created_at  timestamptz not null default now(),
  unique (partner_id, email)
);
create index if not exists acc_partner_members_user on acc_partner_members (user_id);

-- Strategic Machines' platform staff are also the house partner's team (two hats, two rows).
insert into acc_partner_members (partner_id, user_id, email, name, role)
select p.id, a.user_id, a.email, split_part(a.email, '@', 1),
       case a.role when 'staff' then 'operator' else a.role end
from acc_platform_admins a cross join acc_partners p
where p.kind = 'house'
on conflict (partner_id, email) do nothing;

-- Support access to one company, or to all of one partner's companies: explicit, time-boxed, audited.
create table if not exists acc_support_grants (
  id                uuid primary key default gen_random_uuid(),
  granted_to        uuid not null,               -- a platform user
  granted_to_email  text not null,
  org_id            uuid references acc_orgs(id) on delete cascade,
  partner_id        uuid references acc_partners(id) on delete cascade,
  reason            text not null check (length(trim(reason)) > 0),
  granted_by        uuid not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  revoked_at        timestamptz,
  check ((org_id is null) <> (partner_id is null))
);
create index if not exists acc_support_grants_user on acc_support_grants (granted_to, expires_at);

-- Audit rows carry the partner of the company they concern (filled from the company).
alter table acc_admin_audit add column if not exists partner_id uuid references acc_partners(id);
update acc_admin_audit a set partner_id = o.partner_id from acc_orgs o where a.org_id = o.id and a.partner_id is null;

create or replace function acc_audit_partner() returns trigger language plpgsql as $$
begin
  if new.partner_id is null and new.org_id is not null then
    select partner_id into new.partner_id from acc_orgs where id = new.org_id;
  end if;
  return new;
end $$;
drop trigger if exists acc_admin_audit_partner on acc_admin_audit;
create trigger acc_admin_audit_partner before insert on acc_admin_audit
  for each row execute function acc_audit_partner();

alter table acc_partners enable row level security;
alter table acc_partner_members enable row level security;
alter table acc_support_grants enable row level security;
