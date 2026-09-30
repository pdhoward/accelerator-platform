-- Separation + the keys vault (work/flywheel.md §3, I6).
-- 1. Only demo sites show sample data; every real site shows its own or nothing.
-- 2. Site slugs are unique across the platform (pages look sites up by slug).
-- 3. The vault: key values encrypted by the API (AES-256-GCM, VAULT_KEY);
--    never returned to a browser. Development/preview values and the keys the
--    engine itself uses for the site. Production keys live only in Vercel.
-- 4. Work items have a kind: a change, or the site's installation conversation.
-- Additive. API-only tables: RLS on, no policies (service role).

alter table acc_sites add column if not exists demo boolean not null default false;
update acc_sites set demo = true where repo = 'Cypress-Resort/ts-platform';
create unique index if not exists acc_sites_slug_unique on acc_sites (slug);

create table if not exists acc_secrets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references acc_orgs(id) on delete cascade,
  site_id      uuid not null references acc_sites(id) on delete cascade,
  environment  text not null check (environment in ('development','preview','engine')),
  name         text not null check (name ~ '^[A-Z][A-Z0-9_]*$'),
  ciphertext   text not null,                  -- base64
  iv           text not null,                  -- base64, 12 bytes
  tag          text not null,                  -- base64, GCM auth tag
  last4        text not null,                  -- shown instead of the value
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  unique (site_id, environment, name)
);

alter table acc_work add column if not exists kind text not null default 'change' check (kind in ('change','install'));

alter table acc_secrets enable row level security;
