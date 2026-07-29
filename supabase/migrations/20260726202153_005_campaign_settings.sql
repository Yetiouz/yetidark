-- Delve — Campaign settings (chunk 4 of the GM-brain integration)
-- Run this in the Supabase SQL editor after 004_character_avatar.sql.
--
-- House rules and Modes of Play used to only exist as freeform text in
-- the file-based GM system (HOUSE_RULES.md) or as a GM's private choice
-- never surfaced to players. This makes both real, shared, database
-- columns: readable by the whole table, writable only by the GM --
-- exactly the same split the map and encounter tracker already use.
--
-- No new RLS policies needed: these are just two more columns on
-- `campaigns`, and "members can read their campaigns" / "gm can update
-- their campaign" (schema.sql) already cover the whole row.

alter table campaigns add column house_rules text;
alter table campaigns add column modes_of_play jsonb not null default '[]';
