-- Delve — NPC / faction / treasure tracker (chunk 8 of the GM-brain
-- integration), ported from tracker.xlsx's "NPCs", "Factions", and
-- "Treasure & Magic Items" tabs. ("PC Roster" and "Session Index" from
-- that workbook aren't ported -- they duplicate the existing Character
-- Sheet and Campaign Log > Timeline features respectively.)
--
-- The spreadsheet has a "Secret/Motivation" column for NPCs and an
-- implicitly-hidden "Goal" for factions. Rather than build a second
-- private-notes mechanism per entity, those stay out of these tables --
-- the existing private GM Notes (gm_notes table) already covers "the GM
-- knows something the party doesn't" generally.
--
-- Same member-read / gm-write split as campaign_threads/campaign_clocks
-- (006_campaign_log.sql).

create table campaign_npcs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  name text not null,
  ancestry text,
  role text,
  location text,
  alignment text,
  attitude text,
  status text not null default 'Alive',
  notes text,
  created_at timestamptz not null default now()
);

create table campaign_factions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  name text not null,
  type text,
  leader text,
  territory text,
  goal text,
  disposition text,
  status_clock text,
  notes text,
  created_at timestamptz not null default now()
);

create table campaign_treasure (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  session_number int,
  item text not null,
  type text,
  qty_value text,
  found_at text,
  held_by text,
  identified boolean,
  notes text,
  created_at timestamptz not null default now()
);

alter table campaign_npcs enable row level security;
alter table campaign_factions enable row level security;
alter table campaign_treasure enable row level security;

create policy "members can read npcs" on campaign_npcs
  for select using (is_campaign_member(campaign_id));
create policy "gm writes npcs" on campaign_npcs
  for all using (is_campaign_gm(campaign_id));

create policy "members can read factions" on campaign_factions
  for select using (is_campaign_member(campaign_id));
create policy "gm writes factions" on campaign_factions
  for all using (is_campaign_gm(campaign_id));

create policy "members can read treasure" on campaign_treasure
  for select using (is_campaign_member(campaign_id));
create policy "gm writes treasure" on campaign_treasure
  for all using (is_campaign_gm(campaign_id));

alter publication supabase_realtime add table campaign_npcs;
alter publication supabase_realtime add table campaign_factions;
alter publication supabase_realtime add table campaign_treasure;
