-- Accounts, sign-in and Platform Admin (work/accounts-auth-admin.md v0.3).
-- Additive. Every new table is API-only: RLS on, no policies (service role).

-- ── Account lifecycle ───────────────────────────────────────────────────────
alter table acc_orgs add column if not exists status text not null default 'active'
  check (status in ('invited','onboarding','active','past_due','suspended','cancelled'));
alter table acc_orgs add column if not exists billing_mode text not null default 'comped'
  check (billing_mode in ('stripe','invoiced','comped'));
alter table acc_orgs add column if not exists install_fee_quote_usd numeric(12,2);
alter table acc_orgs add column if not exists suspended_at timestamptz;
alter table acc_orgs add column if not exists suspended_reason text;
alter table acc_orgs add column if not exists created_by uuid;

-- ── People ──────────────────────────────────────────────────────────────────
create table if not exists acc_profiles (
  user_id            uuid primary key,          -- auth.users.id
  email              text not null unique,
  mobile_e164        text,
  mobile_verified_at timestamptz,
  sms_consent_at     timestamptz,
  sms_consent_text   text,
  created_at         timestamptz not null default now()
);

create table if not exists acc_platform_admins (
  user_id    uuid primary key,
  email      text not null unique,
  role       text not null check (role in ('owner','admin','staff')),
  added_by   uuid,
  added_at   timestamptz not null default now()
);

create table if not exists acc_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references acc_orgs(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('owner','operator','tester','viewer')),
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at  timestamptz
);
create index if not exists acc_invites_email_open on acc_invites (lower(email)) where accepted_at is null and revoked_at is null;

-- ── Texted codes (generated and checked by the API; only hashes stored) ─────
create table if not exists acc_sms_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  mobile_e164 text not null,
  purpose     text not null check (purpose in ('sign_in','verify_mobile')),
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists acc_sms_codes_lookup on acc_sms_codes (lower(email), purpose, created_at desc);

create table if not exists acc_sms_log (
  id         bigint generated always as identity primary key,
  email      text,
  to_masked  text not null,
  purpose    text not null,
  provider   text not null,           -- twilio · emulator · suppressed
  status     text not null,           -- sent · failed · suppressed
  detail     text,
  at         timestamptz not null default now()
);
create index if not exists acc_sms_log_recent on acc_sms_log (to_masked, at desc);

-- ── Billing (populated when Stripe is wired) ────────────────────────────────
create table if not exists acc_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references acc_orgs(id) on delete cascade,
  stripe_subscription_id text unique,
  plan                   text not null,
  status                 text not null,
  current_period_end     timestamptz,
  mrr_usd                numeric(12,2) not null default 0,
  created_at             timestamptz not null default now()
);

create table if not exists acc_stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

-- ── Audit (every admin action; never deleted) ───────────────────────────────
create table if not exists acc_admin_audit (
  id            bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_email   text,
  action        text not null,
  org_id        uuid references acc_orgs(id) on delete set null,
  detail        jsonb not null default '{}',
  at            timestamptz not null default now()
);

-- Members' email, for display and invite matching.
alter table acc_members add column if not exists email text;

do $$
declare t text;
begin
  foreach t in array array['acc_profiles','acc_platform_admins','acc_invites','acc_sms_codes',
    'acc_sms_log','acc_subscriptions','acc_stripe_events','acc_admin_audit']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
