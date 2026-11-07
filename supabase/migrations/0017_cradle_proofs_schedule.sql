-- The conformance gate's safety net (gen3-cradle.md backlog B5).
-- Every 5 minutes, ask the API to nudge any site whose newest rules are not yet
-- proven. The platform already nudges the app the moment a rule changes; this
-- catches a missed call. Uses the same Vault secrets as 0011
-- (accelerator_api_url, accelerator_cron_secret).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('accelerator-cradle-proofs') where exists (select 1 from cron.job where jobname = 'accelerator-cradle-proofs');

select cron.schedule(
  'accelerator-cradle-proofs',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'accelerator_api_url') || '/api/cron/cradle-proofs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'accelerator_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
