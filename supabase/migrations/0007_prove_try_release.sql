-- Prove · Try · Release: the last three stops of the rail (gen2-crew.md phase G2.1, flywheel.md F14).
-- Prove: the runner runs the full checks, pushes work/<n> and finds its Vercel preview.
-- Try: the Navigator tries the preview and approves it for release (gate 3).
-- Release: the runner merges work/<n> into stage, moves main to stage, and checks the live site.
-- Additive and re-runnable.

alter table acc_work add column if not exists preview_url     text;
alter table acc_work add column if not exists proven_at       timestamptz;  -- the last Prove passed
alter table acc_work add column if not exists proof           jsonb;        -- checks, commit, preview (pass or fail)
alter table acc_work add column if not exists try_approved_at timestamptz;
alter table acc_work add column if not exists try_approved_by uuid;
alter table acc_work add column if not exists released_at     timestamptz;
alter table acc_work add column if not exists release         jsonb;        -- stage/main commits, live check

alter table acc_jobs drop constraint if exists acc_jobs_kind_check;
alter table acc_jobs add constraint acc_jobs_kind_check
  check (kind in ('discuss','design','plan','build_step','checkout','prove','release'));
