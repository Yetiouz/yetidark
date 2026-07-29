-- Delve — Campaign log: threads, clocks, timeline (chunk 5a of the
-- GM-brain integration)
-- Run this in the Supabase SQL editor after 005_campaign_settings.sql.
--
-- The file-based GM system tracks open plot hooks, countdown/countup
-- clocks, and a session-by-session timeline as separate markdown sections
-- (campaign-state.md / timeline.md). This makes all three real, shared
-- tables -- same member-read / gm-write split as everything else GM-
-- controlled (the map, encounter tracker, house rules).

create table campaign_threads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'resolved', 'abandoned')),
  created_at timestamptz not null default now()
);

-- segments_filled / segments_total models a Shadowdark-style clock (e.g.
-- "the ritual completes in 6 segments") without hardcoding any specific
-- clock's meaning -- the GM names it and picks the size.
create table campaign_clocks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  name text not null,
  segments_filled int not null default 0,
  segments_total int not null default 4,
  created_at timestamptz not null default now()
);

-- One row per session recap. session_number defaults to whatever the
-- campaign is currently on (campaigns.session_number already exists) but
-- is editable in case a GM is backfilling an older session.
create table campaign_timeline_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  session_number int,
  entry text not null,
  created_at timestamptz not null default now()
);

alter table campaign_threads enable row level security;
alter table campaign_clocks enable row level security;
alter table campaign_timeline_entries enable row level security;

create policy "members can read campaign threads" on campaign_threads
  for select using (is_campaign_member(campaign_id));

create policy "gm writes campaign threads" on campaign_threads
  for all using (is_campaign_gm(campaign_id));

create policy "members can read campaign clocks" on campaign_clocks
  for select using (is_campaign_member(campaign_id));

create policy "gm writes campaign clocks" on campaign_clocks
  for all using (is_campaign_gm(campaign_id));

create policy "members can read the timeline" on campaign_timeline_entries
  for select using (is_campaign_member(campaign_id));

create policy "gm writes the timeline" on campaign_timeline_entries
  for all using (is_campaign_gm(campaign_id));

-- ---------------------------------------------------------------------
-- Realtime: so the campaign log updates live for everyone at the table,
-- same as the map, encounter tracker, and everything else.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table campaign_threads;
alter publication supabase_realtime add table campaign_clocks;
alter publication supabase_realtime add table campaign_timeline_entries;
