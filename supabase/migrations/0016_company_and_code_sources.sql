-- Accounts and sites, said plainly (2026-11-04): a company has a website; a site is one system, which
-- may live in several code repositories (a web app, an API server, an auth server, a COBOL estate…).
-- Additive and re-runnable. Run on accelerator-test BEFORE deploying the code that uses it.

-- The company's own website (the business), separate from any system it runs.
alter table acc_orgs add column if not exists website text;

-- A site's code, beyond its primary repository (acc_sites.repo / repo_path stay the primary one, which the
-- crew changes). Each extra entry is { "label": "API server", "repo": "owner/name", "path": "C:\\...", "url": "https://..." };
-- the crew reads them all when it ingests the system's policies.
alter table acc_sites add column if not exists sources jsonb not null default '[]'::jsonb;
