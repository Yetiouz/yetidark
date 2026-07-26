# Campaign Database — Start Here

This folder is the persistent memory for this campaign. It exists so that **any** Claude session — including one that has never seen this campaign before — can read a few files and immediately know everything needed to keep running the game exactly where it left off.

## If you are Claude, starting a new session: read in this order

0. **`../GM_PERSONA.md`**, **`../HOUSE_RULES.md`**, and **`../SESSION_PROTOCOL.md`** — how the GM should sound and behave (including the Core GM Commitments: real dice via `../../_TOOLS/dice.py`, rules grounded in `../../_RULES`, calibrated encounters, consequences that stick), any custom house rules in effect, and the pre/post-session checklist. Check this campaign's `campaign-state.md` for any noted overrides (including "Campaign House Rules").
1. **`campaign-state.md`** — the current snapshot. Where the party is right now, what's active, what's owed.
2. **`tracker.xlsx`** — structured data. Tabs: PC Roster, NPCs, Factions, Treasure & Magic Items, Session Index.
3. **`timeline.md`** — the last 2-3 entries at the bottom give recent narrative context. Older entries are history, not required reading every time.
4. **`world.md`** — only pull up the specific location/region/dungeon entry relevant to where the party is now. Don't read the whole file unless doing broad worldbuilding.
5. The character sheets in **`characters/`** — full PC stat blocks.

Shared, campaign-agnostic rules reference (core rulebook, zines, other source PDFs) lives at `../../_RULES` and `../../_ZIP` — pull from there for rules lookups, not for "what happened." Shared GM tooling (dice roller, quick-reference sheets) lives at `../../_TOOLS`. Other campaigns live as sibling folders under `../` — nothing in them applies here.

## After running a session, update:

- Append a new entry to **`timeline.md`** (don't edit old entries — this is a log, not a wiki).
- Overwrite **`campaign-state.md`** with the new current snapshot.
- Update rows in **`tracker.xlsx`** for anything that changed: NPC status, faction standing, new treasure/magic items, new Session Index row.
- Update the relevant character sheet(s) in `characters/` if HP, XP, level, gear, or spells changed.
- If the party entered a new location or region, add/update its entry in `world.md`.
- If this campaign's status changes (started, on hold, completed), update the row in `../README.md`.

## Folder structure

```
[Campaign Name]/
  README.md            <- this file
  campaign-state.md     <- current snapshot, always overwritten (not appended)
  timeline.md           <- append-only session-by-session log
  world.md              <- locations, regions, dungeons — narrative detail
  tracker.xlsx          <- structured data: PCs, NPCs, Factions, Treasure/XP, Session Index
  characters/           <- one markdown sheet per PC
```

## Design principle

Markdown files hold narrative and prose (what happened, why it matters, secrets, relationships). The spreadsheet holds structured lists you'd otherwise flip pages to find (stat lines, status, running totals). When in doubt about where something goes: if it's a fact you'd look up in a table, it's in `tracker.xlsx`; if it's a story you'd need to read, it's in markdown.
