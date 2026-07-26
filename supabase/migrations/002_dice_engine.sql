-- Delve — Dice engine (chunk 1 of the GM-brain integration)
-- Run this in the Supabase SQL editor after schema.sql.
--
-- Brings the app's dice rolling up to the same rigor as the file-based GM
-- system's `dice.py`: real notation (1d8+1d4+2, not just a single die
-- face), advantage/disadvantage on a lone d20 check, automatic nat 20 /
-- nat 1 flagging, and a permanent, auditable log of every roll -- not just
-- the one-line summary that already appears in scene_log.

create table dice_rolls (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  roller_user_id uuid references profiles(id),
  roller_name text not null,
  notation text not null, -- e.g. "1d20+3", "2d6+1", "1d8+1d4+2"
  mode text not null check (mode in ('flat', 'advantage', 'disadvantage', 'self')),
  -- 'self' = a player's own physical-dice roll, reported not generated here.
  reason text, -- what the roll was for, e.g. "Amriel spellcasting check, Magic Missile"
  breakdown text not null, -- human-readable roll detail, e.g. "1d20[14]+3" or the adv/disadv "[a] vs [b]" form
  total int not null,
  raw_d20 int, -- the lone d20's raw face, when this was a single-d20 check (drives crit/fumble)
  is_crit boolean not null default false,
  is_fumble boolean not null default false,
  created_at timestamptz not null default now()
);

-- Lets a scene_log chat line ("Bjorn rolled a 17 to hit") link back to the
-- full audit record (reason, exact breakdown, crit flag) without bloating
-- scene_log itself -- mirrors "the roll is shown, not just the outcome."
alter table scene_log add column dice_roll_id uuid references dice_rolls(id);

alter table dice_rolls enable row level security;

create policy "members can read a campaign's dice rolls" on dice_rolls
  for select using (is_campaign_member(campaign_id));

create policy "members can log dice rolls" on dice_rolls
  for insert with check (is_campaign_member(campaign_id));

-- ---------------------------------------------------------------------
-- Realtime: add dice_rolls to the existing publication so a future roll-
-- history panel can subscribe live, same as every other table.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table dice_rolls;
