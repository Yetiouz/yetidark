-- Shadowdark initiative is "highest d20+DEX starts". Characters already
-- carry their DEX score in stats jsonb; monsters had no ability scores at
-- all, so initiative rolls were a flat 1d20 with no modifier for anyone.
-- This adds a GM-entered DEX modifier per monster so encounter_monsters
-- can participate in the same d20+DEX roll characters do.

alter table encounter_monsters
  add column if not exists dex_mod int not null default 0;
