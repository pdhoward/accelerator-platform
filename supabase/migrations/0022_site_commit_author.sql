-- 0022: who the runner's commits are made as, per site (2026-11-14).
-- For a private repository, Vercel deploys a commit only when its author is a
-- member of the Vercel team. The runner's own identity (Accelerator Engine)
-- isn't, so the blog's preview was refused. A site can name a GitHub account on
-- its Vercel team; the runner then commits as that person and says in each
-- commit message that the Accelerator crew made it. Empty: the engine, which is
-- fine for public repositories. Not a secret: a name and an email address.

alter table acc_sites add column if not exists commit_author_name text;
alter table acc_sites add column if not exists commit_author_email text;
alter table acc_sites drop constraint if exists acc_sites_commit_author_check;
alter table acc_sites add constraint acc_sites_commit_author_check check (
  (commit_author_name is null and commit_author_email is null)
  or (char_length(commit_author_name) between 1 and 80 and commit_author_email ~ '^[^@\s"`$\\]+@[^@\s"`$\\]+$')
);
