-- Control Room fields that 0001 didn't carry yet. Additive only; safe to run once.

-- A change's visual/business details shown in the Change Room: before/after,
-- what else it touches, what stays unchanged, the design doc it follows.
alter table acc_changes add column if not exists request_number integer;
alter table acc_changes add column if not exists details jsonb not null default '{}';

-- Requests can carry a short status note ("2 questions for you").
alter table acc_requests add column if not exists note text;

-- Releases name the request they shipped.
alter table acc_releases add column if not exists request_number integer;

-- Where a document came from (a repo path, a consultation, a Change Room decision).
alter table acc_docs add column if not exists source text;

-- Who took part in a consultation.
alter table acc_consultations add column if not exists participants text[] not null default '{}';

-- Skills: which agent roles use them, and whether they came from the
-- Strategic Machines library or were written for this site. Library skills
-- are copied into each site at onboarding, so switching one off for one site
-- never affects another tenant.
alter table acc_skills add column if not exists used_by text[] not null default '{}';
alter table acc_skills add column if not exists source text not null default 'strategic-machines'
  check (source in ('strategic-machines', 'custom'));
