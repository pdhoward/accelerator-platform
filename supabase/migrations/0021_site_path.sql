-- 0021: each site's path (gen3-cradle.md B31, 2026-11-13).
-- modernize: the crew upgrades the code and builds features as Work items (the
--   Gen 2 path). No industry pack, policy book or Policy Walk; Policy and Graph
--   are hidden, and the Cradle doesn't read the code.
-- transform: the Cradle. The code is read into a policy book, which the owner
--   rules on and the AI app runs from.
-- Chosen when the site is registered and changeable in Setup. Moving from
-- modernize to transform keeps the site's history. Every site that exists when
-- this runs was registered for the Cradle, so they all start as transform; new
-- sites default to modernize, the smaller step.

alter table acc_sites add column if not exists path text;
update acc_sites set path = 'transform' where path is null;
alter table acc_sites alter column path set default 'modernize';
alter table acc_sites alter column path set not null;
alter table acc_sites drop constraint if exists acc_sites_path_check;
alter table acc_sites add constraint acc_sites_path_check check (path in ('modernize', 'transform'));
