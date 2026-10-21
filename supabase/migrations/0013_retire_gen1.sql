-- Traceability T7 (gen2-crew.md §21.6): retire the Gen 1 tables. Owner-requested 2026-10-20.
--
-- Gen 2 records replace them: Work items (acc_work and its messages, documents and steps), decisions
-- (acc_decisions), evidence (acc_evidence), the Change Ledger (acc_ledger), versioned documents
-- (acc_documents, acc_document_versions) and the crew's skill tiers (acc_skills rows with a scope).
--
-- ORDER: deploy the code first (commit "Retire Gen 1"), which no longer reads any of these, THEN run
-- this. It is irreversible: export anything you want to keep first (e.g. from the SQL editor:
-- select * from acc_requests). Re-runnable: every drop is "if exists".

-- Children first (they reference acc_changes, acc_requests and acc_docs).
drop table if exists acc_approvals cascade;
drop table if exists acc_test_runs cascade;
drop table if exists acc_releases cascade;
drop table if exists acc_consultations cascade;
drop table if exists acc_changes cascade;
drop table if exists acc_requests cascade;
drop table if exists acc_docs cascade;

-- Gen 1 skills: the copied "library" rows with no tier. Crew and domain skills now live in code;
-- partner, company and site skills are rows with a scope (migration 0012).
delete from acc_skills where scope is null;
alter table acc_skills drop column if exists used_by;

-- To check: none of these should be listed.
-- select table_name from information_schema.tables where table_schema = 'public'
--   and table_name in ('acc_requests','acc_changes','acc_approvals','acc_releases','acc_docs','acc_consultations','acc_test_runs');
