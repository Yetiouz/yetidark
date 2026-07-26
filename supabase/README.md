# Database schema (Phase 2)

`schema.sql` is the real data model behind everything currently running on
mock data in `src/mockData.js`. It's not wired up yet — this is the design
step before Phase 3 (real accounts) and Phase 4 (swapping mock data for
live queries).

## What's in it

- `profiles` — one row per signed-in user
- `campaigns` — one row per campaign (name, system, human or AI GM, join code)
- `campaign_members` — who's in a campaign and whether they're the GM or a player
- `characters` — Shadowdark characters, scoped to one campaign per owner
- `encounter_monsters` — the current fight, including hidden monsters
- `gm_notes` — private notes until the GM reveals them
- `hex_cells` — one row per hex on the fog-of-war map
- `scene_log` — the shared feed: narration, chat, GM lines, dice rolls (app or self-reported)
- `turn_order` — current initiative order
- `votes` — lightweight group polls like "where to next?"

Every table has row-level security turned on, scoped to campaign
membership. `gm_notes` and `encounter_monsters` additionally hide anything
not yet revealed from non-GM members — enforced by the database itself,
not just the UI, so there's no way for a player to see GM secrets by
poking at the API directly.

## Setting it up (when we get to Phase 3)

1. Create a project at supabase.com (free tier).
2. Open the SQL Editor and run `schema.sql`.
3. Go to Database > Replication and turn on realtime for: `scene_log`,
   `hex_cells`, `encounter_monsters`, `turn_order`, `votes`, `characters`.
4. Grab the project URL and anon key from Project Settings > API — those
   go into environment variables the app reads at build time.
