-- The nightly retention job on Supabase (gen2-crew.md §21.4, T4). All scheduled jobs run on Supabase:
-- pg_cron schedules, pg_net calls the API route that does the work (it compresses logs and uploads them
-- to Storage, so it runs in the API), and the API's address and shared secret come from Supabase Vault.
-- Nothing secret is in this file. Re-runnable: scheduling the same job name again replaces it.
--
-- Before running this, create the two Vault secrets once (SQL editor):
--   select vault.create_secret('https://<your-api-domain>', 'accelerator_api_url');
--   select vault.create_secret('<the same value as CRON_SECRET on the API>', 'accelerator_cron_secret');
-- To change one later: select vault.update_secret((select id from vault.secrets where name = '<name>'), '<new value>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'accelerator-retention',
  '30 4 * * *', -- every night at 04:30 UTC
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'accelerator_api_url') || '/api/cron/retention',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'accelerator_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- To check it ran: select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'accelerator-retention') order by start_time desc limit 5;
-- And the API's answer (a JSON report): select status_code, content from net._http_response order by created desc limit 5;
