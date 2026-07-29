-- Record which rules version and source rolls produced a character. Existing
-- characters remain valid and are explicitly marked as pre-versioning rows.

alter table characters
  add column rules_version text not null default 'legacy-unversioned',
  add column creation_rolls jsonb not null default '{}'::jsonb;
