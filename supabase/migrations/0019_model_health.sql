-- Model health (gen3-cradle.md B18): a running app reports when it can't reach its AI model
-- (out of credit, key rejected, provider overloaded), so the platform shows it instead of the
-- owner finding it in the logs. The reports are health snapshots of a new kind, 'model':
--   data = { source: 'app', kind, role, model, status, message }   (message has keys masked)
--
-- Idempotent. No new table, so no new grants: 0018 already grants service_role on
-- acc_health_snapshots, and anon / authenticated get nothing.

alter table acc_health_snapshots drop constraint if exists acc_health_snapshots_kind_check;
alter table acc_health_snapshots add constraint acc_health_snapshots_kind_check
  check (kind in ('lighthouse', 'architecture', 'model'));
