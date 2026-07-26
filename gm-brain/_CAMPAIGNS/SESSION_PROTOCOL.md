# Session Protocol

The core rulebook doesn't provide a prep checklist or a database-update discipline — this file is that missing piece. Applies to every campaign under `_CAMPAIGNS/` unless a campaign's `campaign-state.md` says otherwise.

## Before a session (prep situations, not plots)

Don't write a fixed story the players are expected to follow. Instead, before play, make sure you (the GM) have:

1. **Read the current state** — `campaign-state.md`, `tracker.xlsx`, and the last 2-3 `timeline.md` entries for this campaign. Don't start improvising until this is done.
2. **Faction/threat clocks reviewed** — check `campaign-state.md` > Ongoing threats/clocks. Decide what advances this session whether or not the party engages with it.
3. **NPCs who might show up** — pull their motivations/secrets from `tracker.xlsx` > NPCs rather than inventing new ones on the spot when an established NPC would fit.
4. **At least 2-3 plausible directions** the party could take from where they left off, each with enough prepped (a location, an encounter table, an NPC) to run it — not a single expected path.
5. **Relevant tables ready** — terrain encounter tables, `_TOOLS/ENCOUNTER_TREASURE_REFERENCE.md` for calibrating anything new, `_TOOLS/GM_QUICK_REFERENCE.md` for rules that will come up often this session.
6. **GM_PERSONA.md checked** — tone, lethality, and any table preferences still apply as written, or the campaign's override is noted.
7. **HOUSE_RULES.md checked** — know which custom house rules are active (and any this campaign has turned off or modified in its own `campaign-state.md` > Campaign House Rules) before they'd come up mid-session.

## During the session

- Roll everything real through `_TOOLS/dice.py` — don't narrate an outcome without rolling it first.
- Look up non-trivial rulings in the actual source PDFs (`_RULES/`) rather than reconstructing from memory.
- Let dice and player choices stand. No retroactive softening of a bad outcome to protect the story or a PC.
- If something a player does would advance or defuse a tracked faction/clock, note it (mentally or on paper) to log after the session.

## After a session (don't skip this — it's the whole point of the database)

1. **Append** a new entry to `timeline.md` (never edit old entries).
2. **Overwrite** `campaign-state.md` with the new snapshot: location, active threads, updated clocks, pending mechanical items, next-session pickup point.
3. **Update `tracker.xlsx`**: NPC status changes, faction disposition/clock progress, new treasure/magic items, a new Session Index row.
4. **Update character sheets** in `characters/` for HP, XP, level, gear, spell, or condition changes.
5. **Update `world.md`** if a new location was introduced or an existing one changed.
6. **Occasional table check-in** — every few sessions, ask whether tone/pacing/difficulty is landing. If something should change, update `GM_PERSONA.md` (or the campaign's override section) — don't just adjust silently and hope it's remembered next time.
7. **New house rule agreed on?** Add it to `HOUSE_RULES.md` (as Active or Proposed) rather than just applying it informally and hoping it's remembered — that's the whole reason the file exists.
