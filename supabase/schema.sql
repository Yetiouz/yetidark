-- Delve data model
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).
-- Maps 1:1 onto src/mockData.js so swapping mock data for real queries later
-- is mostly a find-and-replace.

create extension if not exists "pgcrypto";

-- One row per signed-in user. Supabase creates auth.users automatically on
-- sign-in; this table holds the display info the app actually shows.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- A campaign is one ongoing game (e.g. "The sunken keep"). map_url/map_cols/
-- map_rows describe the uploaded map image and the grid overlaid on it;
-- party_row/party_col track where the party marker sits on that grid.
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  system text not null default 'Shadowdark',
  gm_type text not null check (gm_type in ('human', 'ai')),
  gm_user_id uuid references profiles(id),
  join_code text not null unique,
  session_number int not null default 1,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  map_url text,
  map_cols int not null default 10,
  map_rows int not null default 6,
  party_row int,
  party_col int,
  created_at timestamptz not null default now()
);

-- Who belongs to a campaign, and whether they're the GM or a player.
-- A GM campaign has one member with role='gm'; an AI-GM campaign has none.
create table campaign_members (
  campaign_id uuid references campaigns(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null check (role in ('gm', 'player')),
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- Characters belong to a user but are scoped to one campaign, so the same
-- player can have a different character per campaign (matches the character
-- picker screen showing characters "from this campaign or a past one").
create table characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  owner_user_id uuid references profiles(id) on delete cascade,
  name text not null,
  ancestry text not null,
  class text not null,
  level int not null default 1,
  stats jsonb not null, -- {"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}
  hp int not null,
  max_hp int not null,
  ac int not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Monsters in the current fight. hidden=true means the GM sees it but
-- players don't yet -- RLS below enforces that.
create table encounter_monsters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  name text not null,
  ac int not null,
  hp int not null,
  max_hp int not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- GM-only notes until explicitly revealed to the party.
create table gm_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  text text not null,
  revealed boolean not null default false,
  created_at timestamptz not null default now()
);

-- One row per grid cell overlaid on the campaign's uploaded map image.
-- state starts 'fog' (an opaque tile hiding the map underneath) and flips
-- to 'explored' (transparent, map shows through) permanently -- per the
-- honor-system fog-of-war design -- unless the GM uses the "re-fog" control
-- to clear cells for a story reason like amnesia. Cells are created lazily:
-- a missing row for (campaign, row, col) just means 'fog'.
create table map_cells (
  campaign_id uuid references campaigns(id) on delete cascade,
  row int not null,
  col int not null,
  state text not null default 'fog' check (state in ('fog', 'explored')),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, row, col)
);

-- The shared scene log: narration, chat, GM lines, and dice rolls (both
-- app-rolled and self-reported), all in one ordered feed.
create table scene_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  type text not null check (type in ('narration', 'chat', 'gm', 'roll')),
  sender_user_id uuid references profiles(id),
  sender_name text not null,
  text text not null,
  roll_source text check (roll_source in ('app', 'self')),
  created_at timestamptz not null default now()
);

-- Current initiative order for a campaign. Kept as one jsonb row per
-- campaign rather than one row per combatant since it's small, changes as
-- a unit each round, and just needs to broadcast over realtime.
create table turn_order (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  order_list jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Lightweight group polls, e.g. the "where to next?" vote on the map tab.
-- unique(poll_key, voter_user_id) means re-voting changes your vote instead
-- of adding a second one.
create table votes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  poll_key text not null,
  option_key text not null,
  option_label text not null,
  voter_user_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (poll_key, voter_user_id)
);

-- ---------------------------------------------------------------------
-- Auto-create a profile row whenever someone signs up for the first time,
-- so profiles.display_name always has something sensible without the app
-- needing a separate "finish your profile" step.
-- ---------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Row level security: every table is scoped to campaigns a user belongs
-- to. gm_notes additionally hides unrevealed notes from non-GM members,
-- and encounter_monsters hides hidden monsters the same way.
-- ---------------------------------------------------------------------

alter table profiles enable row level security;
alter table campaigns enable row level security;
alter table campaign_members enable row level security;
alter table characters enable row level security;
alter table encounter_monsters enable row level security;
alter table gm_notes enable row level security;
alter table map_cells enable row level security;
alter table scene_log enable row level security;
alter table turn_order enable row level security;
alter table votes enable row level security;

create or replace function is_campaign_member(target_campaign_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from campaign_members
    where campaign_id = target_campaign_id and user_id = auth.uid()
  );
$$;

create or replace function is_campaign_gm(target_campaign_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from campaign_members
    where campaign_id = target_campaign_id and user_id = auth.uid() and role = 'gm'
  );
$$;

create policy "profiles are self-readable" on profiles
  for select using (true); -- display names are fine to be publicly readable

create policy "users can update their own profile" on profiles
  for update using (id = auth.uid());

create policy "members can read their campaigns" on campaigns
  for select using (is_campaign_member(id));

create policy "authenticated users can create campaigns" on campaigns
  for insert with check (auth.uid() is not null);

create policy "gm can update their campaign" on campaigns
  for update using (is_campaign_gm(id));

create policy "members can read the member list" on campaign_members
  for select using (is_campaign_member(campaign_id));

create policy "users can add themselves as a member" on campaign_members
  for insert with check (user_id = auth.uid());

create policy "users can leave a campaign" on campaign_members
  for delete using (user_id = auth.uid());

create policy "members can read campaign characters" on characters
  for select using (is_campaign_member(campaign_id));

create policy "owners can write their own characters" on characters
  for insert with check (owner_user_id = auth.uid() and is_campaign_member(campaign_id));

create policy "owners and gm can update characters" on characters
  for update using (owner_user_id = auth.uid() or is_campaign_gm(campaign_id));

create policy "gm sees all monsters, players see non-hidden" on encounter_monsters
  for select using (
    is_campaign_gm(campaign_id) or (is_campaign_member(campaign_id) and hidden = false)
  );

create policy "only gm writes monsters" on encounter_monsters
  for all using (is_campaign_gm(campaign_id));

create policy "gm sees all notes, players see revealed only" on gm_notes
  for select using (
    is_campaign_gm(campaign_id) or (is_campaign_member(campaign_id) and revealed = true)
  );

create policy "only gm writes notes" on gm_notes
  for all using (is_campaign_gm(campaign_id));

create policy "members can read map cells" on map_cells
  for select using (is_campaign_member(campaign_id));

create policy "members can reveal map cells" on map_cells
  for insert with check (is_campaign_member(campaign_id));

create policy "members can update map cells" on map_cells
  for update using (is_campaign_member(campaign_id));

create policy "gm can delete map cells" on map_cells
  for delete using (is_campaign_gm(campaign_id));

create policy "members can read the scene log" on scene_log
  for select using (is_campaign_member(campaign_id));

create policy "members can post to the scene log" on scene_log
  for insert with check (is_campaign_member(campaign_id));

create policy "members can read turn order" on turn_order
  for select using (is_campaign_member(campaign_id));

create policy "gm updates turn order" on turn_order
  for all using (is_campaign_gm(campaign_id));

create policy "members can read and cast votes" on votes
  for select using (is_campaign_member(campaign_id));

create policy "members can vote" on votes
  for insert with check (is_campaign_member(campaign_id) and voter_user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Storage: a public "maps" bucket holds uploaded map images. Public read
-- means anyone with the URL can view an image (fine -- URLs aren't
-- guessable and images aren't sensitive); only signed-in users can upload.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('maps', 'maps', true)
on conflict (id) do nothing;

create policy "anyone can view map images" on storage.objects
  for select using (bucket_id = 'maps');

create policy "authenticated users can upload map images" on storage.objects
  for insert with check (bucket_id = 'maps' and auth.uid() is not null);

create policy "authenticated users can replace map images" on storage.objects
  for update using (bucket_id = 'maps' and auth.uid() is not null);

-- ---------------------------------------------------------------------
-- Realtime: turn these on in Supabase (Database > Replication) so the
-- live table and GM dashboard update instantly for everyone connected,
-- instead of needing a page refresh.
-- ---------------------------------------------------------------------
-- Tables to enable: map_cells, campaigns (map image/grid/party updates),
-- scene_log, encounter_monsters, turn_order, votes, characters (for HP
-- changes).
