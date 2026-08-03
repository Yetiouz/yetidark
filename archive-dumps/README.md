# Attempt One — archived 2026-08-03

This branch (`archive/attempt-1`, also tagged `attempt-1`) is the complete frozen
state of Delve's first build: full git history, plus the live database captured
below at the moment of archival, immediately before the database was wiped.

## What's in `archive-dumps/`
- `live-migration-history.json` — all 63 applied migrations WITH their full SQL
  statements, straight from `supabase_migrations.schema_migrations`. The repo's
  `supabase/migrations/` only goes to 036; the ~27 later migrations were applied
  live via MCP and never committed — this file is their only record.
- `drifted-migrations-post-036.sql` — those 27 live-only migrations rendered as
  runnable SQL, in order. `supabase/migrations/*` + this file = the complete
  schema of attempt one.
- `table-data.json` — every row of every public table (32 tables, 237 rows).
- `auth-and-storage.json` — auth users (ids/emails/metadata, password hashes
  deliberately excluded), storage buckets, and a storage-object inventory.
  Note: the 2 storage binaries (map/avatar images) are NOT archived — only
  their paths.

## Rebuilding attempt one
Migrations 001–036 from `supabase/migrations/`, then `drifted-migrations-post-036.sql`,
then restore `table-data.json`, deploy `supabase/functions/ai-gm-turn`, point the
frontend env at the project. CI was fully green at archival (all 171 pgTAP tests).
