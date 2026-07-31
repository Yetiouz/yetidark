-- 031: character color + zone (close/near/far) for the new zone-ring scene
-- rendering, replacing the hex-grid/fog map on the player table. See
-- docs/ROADMAP.md, Milestone 1 "Design decisions confirmed" for why: this
-- models Shadowdark's actual unmeasured close/near/far range bands instead
-- of cell-by-cell grid movement, and gives each character a persistent
-- color used consistently across the map, header, and chat.

alter table characters
  add column if not exists color text,
  add column if not exists zone text not null default 'near' check (zone in ('close', 'near', 'far'));

alter table encounter_monsters
  add column if not exists zone text not null default 'near' check (zone in ('close', 'near', 'far'));

comment on column characters.color is
  'Hex color assigned once per character, reused everywhere the character shows up: map token, header presence avatar, chat sender name, party HP list. Nullable -- the UI falls back to a default blue when unset.';
comment on column characters.zone is
  'Which Shadowdark range band this character currently occupies in the active scene: close (melee), near (~30ft), or far (in sight). Replaces the old shared party_row/party_col marker with independent per-character positioning.';
comment on column encounter_monsters.zone is
  'Same close/near/far range band as characters.zone, for the monster''s position in the active scene.';

-- Backfill existing characters with a color from a fixed 8-color palette,
-- cycling by creation order within each campaign so two characters in the
-- same campaign don't collide until a 9th joins the party.
with palette(idx, hex) as (
  values (0, '#3b82f6'), (1, '#a855f7'), (2, '#22c55e'), (3, '#f59e0b'),
         (4, '#ec4899'), (5, '#14b8a6'), (6, '#ef4444'), (7, '#06b6d4')
),
ordered as (
  select id, campaign_id,
         row_number() over (partition by campaign_id order by created_at) - 1 as rn
  from characters
  where color is null
)
update characters c
set color = p.hex
from ordered o
join palette p on p.idx = o.rn % 8
where c.id = o.id;

alter table characters alter column color set default '#3b82f6';

-- No RLS changes needed: the existing "owners and gm can update characters"
-- and "only gm writes monsters" policies already cover these new columns
-- since they're plain column additions, not new tables. characters and
-- encounter_monsters are already in the supabase_realtime publication, so
-- zone/color changes broadcast live with no publication changes either.
