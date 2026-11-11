-- 0020: what a site is, in its owner's words (gen3-cradle.md, 2026-11-11).
-- The running Cradle app introduces itself from this ("Machine Shop: a home and
-- workshop store with about 10,000 products"), so no platform code names a site.
-- Plain text, set when the site is registered or edited; served to the app in
-- its runtime book. Nullable: the app falls back to its industry pack's summary.

alter table acc_sites add column if not exists description text;
alter table acc_sites drop constraint if exists acc_sites_description_length;
alter table acc_sites add constraint acc_sites_description_length check (description is null or char_length(description) <= 1000);
