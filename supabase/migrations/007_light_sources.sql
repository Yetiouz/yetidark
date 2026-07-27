-- Delve — Light source tracking (chunk 5b of the GM-brain integration)
-- Run this in the Supabase SQL editor after 006_campaign_log.sql.
--
-- The file-based GM system tracks light sources in real time, but only
-- while the table is actively playing -- a paused session (break, table
-- talk) doesn't burn a torch down. This brings that same active-play-time
-- -only behavior into the app: a per-campaign session_active toggle the
-- GM starts/pauses, and light sources whose remaining burn time only
-- ticks down while both the session is active AND the source is lit.

alter table campaigns add column session_active boolean not null default false;

-- remaining_minutes is the source of truth as of the last time it was
-- "frozen" (snuffed, or the session was paused while it was lit). lit_at
-- is non-null only while the source is actively burning (lit AND the
-- session is active) -- the client computes live remaining time as
-- remaining_minutes minus elapsed time since lit_at, so no server-side
-- ticking is needed.
create table campaign_light_sources (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  character_id uuid references characters(id) on delete set null, -- null = shared/party light source
  name text not null,
  total_minutes int not null,
  remaining_minutes numeric not null,
  lit boolean not null default false,
  lit_at timestamptz,
  created_at timestamptz not null default now()
);

alter table campaign_light_sources enable row level security;

create policy "members can read light sources" on campaign_light_sources
  for select using (is_campaign_member(campaign_id));

-- Mirrors character_gear's owner-or-gm pattern: the GM can manage any
-- light source (including unassigned/party ones); a player can only
-- light/snuff a source assigned to their own character.
create policy "owner or gm can write light sources" on campaign_light_sources
  for all using (
    is_campaign_gm(campaign_id)
    or (
      character_id is not null and exists (
        select 1 from characters c
        where c.id = campaign_light_sources.character_id and c.owner_user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------
-- Realtime: so every burning torch's remaining time is visible live to
-- the whole table, same as everything else.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table campaign_light_sources;
