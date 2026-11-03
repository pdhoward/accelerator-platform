-- Gen 3, Pilot 2 (accelerator/work/gen3-cradle.md §11.7, G3-D25): the Cards industry pack, for
-- credit-card issuing (AWS CardDemo). The pack itself lives in code (packages/domain/src/cradle-packs.ts);
-- the database only has to accept its name. Additive and re-runnable. Run on accelerator-test BEFORE
-- deploying the code that uses it.

-- A site's industry (Configuration picker, crew guidance).
alter table acc_sites drop constraint if exists acc_sites_domain_check;
alter table acc_sites add constraint acc_sites_domain_check
  check (domain is null or domain in ('commerce','hospitality','cards'));

-- The pack a site's cradle started from (the check was declared inline in 0014, so it has the default name).
alter table acc_cradles drop constraint if exists acc_cradles_pack_check;
alter table acc_cradles add constraint acc_cradles_pack_check
  check (pack in ('commerce','hospitality','cards'));
