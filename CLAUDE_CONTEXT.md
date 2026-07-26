Delve — project context for a new Claude/Cowork session

Purpose of this file: paste this (or point Claude at its GitHub URL) at the start of a fresh Cowork/Claude conversation on any computer, so it can pick up this project without the previous chat history.

## What Delve is

A multiplayer web app for running Shadowdark RPG campaigns, with either a human or (eventually) AI game master. Players and the GM join a shared "game table": a live map with hex-grid fog of war, a scene log, party chat, dice rolling, turn order, and a GM-only dashboard for running encounters.

## Where everything lives

- Code: GitHub repo `Yetiouz/yetidark`, branch `main`. All changes are committed directly to `main` (no PR workflow in use).
- Live app: https://yetidark.vercel.app — Vercel auto-deploys on every push to `main` (usually live within ~1 minute; hard-refresh if a change doesn't appear immediately).
- Backend: Supabase (Postgres + Auth + Storage + Realtime). Schema and RLS policies are kept in `supabase/schema.sql` in the repo and mirrored on the live Supabase project — that file should always match the live DB.
- Stack: React 18 + Vite + Tailwind CSS (utility classes only, no compiler access), `lucide-react` icons. No test suite; changes are verified by reading the diff and (for JS) a Python bracket-balance check before pushing, since there's no local build step available.

## Current status (as of this file's last update)

Phases 1–4 are complete: real Supabase auth, campaign lobby (create/join by code), character creation/picker, a full profile page, and the live game table are all wired to real data — nothing in the app reads from mock data anymore.

Game table features, all real-time and backed by Supabase:
- Map: GM uploads one image; a flat-top hex grid overlays it; fog is fully opaque until the GM reveals a cell (players cannot unfog — GM-only both in the UI and in RLS policy). The grid auto-sizes to the image's real aspect ratio so nothing crops.
- Scene log, Map, and Party chat are three separate always-visible panels (not tabs) on both the player table (`GameTable.jsx`) and the GM dashboard (`GmDashboard.jsx`). Scene log shows narration/GM lines/dice rolls; Party chat is players' own OOC conversation. Both auto-scroll to the newest entry.
- Dice: app-rolled buttons (d20/d12/d10/d8/d6/d4) show a short spin animation before landing on the result; there's also a manual "log your own roll" field for physical dice (honor system). Rolls are tagged `roll_source: 'app' | 'self'` in the log.
- Turn order and a "where to next?" party vote are live and GM-controlled.
- GM dashboard: encounter/monster HP tracker (with hidden-monster support), private GM notes (revealed to party on demand), map controls (upload/replace image, grid size, move party marker, re-fog), plus its own Scene log + Party chat panels mirroring the player view.
- All Supabase writes/reads use realtime subscriptions (`postgres_changes`) so every connected client updates instantly; own actions are also echoed locally immediately (via `.insert().select().single()`) rather than waiting on the realtime round-trip, since that round-trip was previously the source of a "dice/chat don't seem to work" bug.

## Things a new session should know before touching the backend

1. **RLS + RETURNING gotcha**: if an `INSERT ... RETURNING` (i.e. supabase-js `.insert().select()`) requires a row that doesn't exist yet to satisfy its own SELECT policy (e.g. creating a campaign before you're a `campaign_members` row), Postgres raises "new row violates row-level security policy" even though the INSERT's own `WITH CHECK` passed. An `AFTER INSERT` trigger does not reliably fix this. The real fix: generate the id client-side (`crypto.randomUUID()`), insert without `.select()`, then create the dependent row separately. This is already handled correctly in `Lobby.jsx`'s `createCampaign` — don't "fix" it back to using `.select()`.
2. **Debugging RLS live**: to test exactly what a real signed-in user can/can't do, run this against the Supabase SQL editor inside a rolled-back transaction:
   ```sql
   begin;
   set local role authenticated;
   set local "request.jwt.claims" = '{"sub":"<user-uuid>","role":"authenticated"}';
   -- test statement here
   rollback;
   ```
   This has been far more reliable than guessing from error messages alone.
3. **Realtime**: a table only pushes `postgres_changes` events if it's in the `supabase_realtime` publication. Currently enabled: `map_cells`, `campaigns`, `scene_log`, `encounter_monsters`, `gm_notes`, `turn_order`, `votes`, `characters`. If a new realtime feature seems to silently not update other clients, check this first via `select tablename from pg_publication_tables where pubname='supabase_realtime'`.
4. **Hex grid math** (`src/components/MapGrid.jsx`): flat-top hexagons in "offset column" layout — `clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)`, `HEX_ASPECT = 0.866` (√3/2), horizontal step = `0.75 * hexWidth`, alternating columns offset vertically by half a hex height. The container sizes itself to the uploaded image's real aspect ratio (read via the `<img>`'s `onLoad`), not a fixed cols/rows ratio, so the whole image is always visible.

## Open items / not yet done

- Phase 5 (playtest with real friends) and Phase 6 (AI GM) haven't been started — everything so far has been a human-GM app.
- Nothing else is known-broken as of this writing; the last few sessions were bug fixes reported live by the user (invisible dice/chat feedback, map cropping, fog opacity, hex vs square grid, GM-only unfog, missing GM-side scene log) and all were fixed and pushed.

## How to pick this back up on a new device

1. Tell Claude you're continuing work on "Delve", the Shadowdark campaign app, and point it at this file: `https://github.com/Yetiouz/yetidark/blob/main/CLAUDE_CONTEXT.md` (or paste its contents directly).
2. The GitHub and Supabase connections are tied to your account, not this device, so they should already be available in a new Cowork session — if Claude says a connector isn't connected, just approve it again when prompted.
3. Say what you want done next; Claude can read any file in the repo directly from GitHub without needing a local clone.
