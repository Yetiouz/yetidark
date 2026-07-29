-- Delve — Character sheet (chunk 2 of the GM-brain integration)
-- Run this in the Supabase SQL editor after 002_dice_engine.sql.
--
-- The `characters` table only ever stored name/ancestry/class/level/stats/
-- hp/ac -- enough for the compact HP/AC card in GameTable, but nothing
-- close to a real Shadowdark sheet (no XP, no gear, no talents, no coin,
-- no background). CharacterBuilder's UI has claimed "starting gear
-- auto-added" since it was written; this is what makes that true.

alter table characters add column alignment text;
alter table characters add column background text;
alter table characters add column xp int not null default 0;
alter table characters add column coin numeric not null default 0;

-- One row per carried item. `equipped` exists so a future house-rules
-- layer (e.g. "equipped items don't count against gear slots") can change
-- how slots are totaled without changing this table -- for now, every
-- row's `slots` counts toward the character's STR-or-10 slot limit,
-- matching core rules as written.
create table character_gear (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references characters(id) on delete cascade,
  name text not null,
  slots numeric not null default 1,
  equipped boolean not null default false,
  quantity int not null default 1,
  notes text,
  created_at timestamptz not null default now()
);

-- One row per talent a character has (class talents, ancestry bonuses,
-- etc.) -- replaces the flat, unstructured "+1 damage" text that
-- previously lived nowhere in the data model.
create table character_talents (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references characters(id) on delete cascade,
  source text not null, -- e.g. "class talent", "ancestry bonus"
  description text not null,
  created_at timestamptz not null default now()
);

alter table character_gear enable row level security;
alter table character_talents enable row level security;

-- Both tables key off character_id, not campaign_id directly, so their
-- RLS joins back through `characters` to reuse the existing
-- is_campaign_member / is_campaign_gm helpers from schema.sql.

create policy "members can read a character's gear" on character_gear
  for select using (
    exists (
      select 1 from characters c
      where c.id = character_gear.character_id and is_campaign_member(c.campaign_id)
    )
  );

create policy "owner or gm can write a character's gear" on character_gear
  for all using (
    exists (
      select 1 from characters c
      where c.id = character_gear.character_id
        and (c.owner_user_id = auth.uid() or is_campaign_gm(c.campaign_id))
    )
  );

create policy "members can read a character's talents" on character_talents
  for select using (
    exists (
      select 1 from characters c
      where c.id = character_talents.character_id and is_campaign_member(c.campaign_id)
    )
  );

create policy "owner or gm can write a character's talents" on character_talents
  for all using (
    exists (
      select 1 from characters c
      where c.id = character_talents.character_id
        and (c.owner_user_id = auth.uid() or is_campaign_gm(c.campaign_id))
    )
  );

-- ---------------------------------------------------------------------
-- Realtime: so a character sheet updates live if the GM adjusts XP/coin
-- or the player manages gear, same as everything else in the app.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table character_gear;
alter publication supabase_realtime add table character_talents;
