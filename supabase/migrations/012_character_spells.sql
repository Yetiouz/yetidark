-- Delve — Character spells
-- Run this in the Supabase SQL editor after 011_ai_gm.sql.
--
-- Same shape as character_gear / character_talents from
-- 003_character_sheet.sql: one row per spell, keyed off character_id, RLS
-- joins back through `characters` to reuse is_campaign_member /
-- is_campaign_gm. Available on every character rather than gated by
-- class, since homebrew casters exist outside the two core Shadowdark
-- casting classes.
--
-- `lost` exists for Shadowdark's spell-loss rule: casting requires a roll,
-- and a natural 1 makes that spell Lost until the caster benefits from a
-- full rest -- a real mechanical state, not just flavor text, so it gets
-- its own toggle instead of living in `notes`.
create table character_spells (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references characters(id) on delete cascade,
  name text not null,
  tier int not null default 1,
  range text,
  duration text,
  description text,
  prepared boolean not null default false,
  lost boolean not null default false,
  created_at timestamptz not null default now()
);

alter table character_spells enable row level security;

create policy "members can read a character's spells" on character_spells
  for select using (
    exists (
      select 1 from characters c
      where c.id = character_spells.character_id and is_campaign_member(c.campaign_id)
    )
  );

create policy "owner or gm can write a character's spells" on character_spells
  for all using (
    exists (
      select 1 from characters c
      where c.id = character_spells.character_id
        and (c.owner_user_id = auth.uid() or is_campaign_gm(c.campaign_id))
    )
  );

alter publication supabase_realtime add table character_spells;
