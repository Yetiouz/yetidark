# Campaigns Index — Start Here

This folder holds one subfolder per campaign. Each campaign is fully self-contained and independent — its own state, timeline, NPCs, factions, characters. Nothing about one campaign should be assumed true in another.

Shared, campaign-agnostic reference material (core rulebook, Cursed Scroll zines, other source PDFs) lives one level up in `../_RULES` and `../_ZIP` — that material is common to all campaigns and isn't duplicated here (and isn't copied into this repo either — see the top-level `gm-brain/README.md`). Shared GM tooling (dice roller, quick-reference sheets) lives in `../_TOOLS`.

## If you are Claude, starting a new session

1. Read **`GM_PERSONA.md`** first — how the GM should sound and behave, table preferences, lethality, content lines, and the Core GM Commitments (dice integrity, rules grounding, etc.). This applies across all campaigns unless a campaign's `campaign-state.md` notes an override.
2. Read **`HOUSE_RULES.md`** — custom rules that change or add to the core rules, distinct from official Modes of Play toggles. Applies to all campaigns unless a campaign's `campaign-state.md` > "Campaign House Rules" says otherwise.
3. Read **`SESSION_PROTOCOL.md`** — the pre-session and post-session checklist. Follow it every session, not just when reminded.
4. Figure out **which campaign** the user means. If it's ambiguous and more than one campaign is listed above, ask which one before doing anything — don't guess.
5. Once you know the campaign, go into `<Campaign Name>/` and follow that campaign's own `README.md` (same read-order pattern: `campaign-state.md` → `tracker.xlsx` → recent `timeline.md` entries → `world.md` as needed → `characters/`).
6. Treat `../_RULES` and `../_ZIP` as shared rules reference, and `../_TOOLS` (dice roller + quick-reference sheets) as shared GM tooling — both usable by any campaign.

## Starting a new campaign

1. Copy `_TEMPLATE/` to a new folder named after the campaign (e.g. `_CAMPAIGNS/The Sunken Crown/`).
2. Fill in that campaign's `campaign-state.md` and `README.md` header with the setting/party once known — don't pre-populate it with guesses.
3. Decide that campaign's **Campaign-Specific Settings** (in `campaign-state.md`) — things like rules adjudication style vary enough by campaign that they're set per-campaign rather than inherited from `GM_PERSONA.md`.
4. Add a row to the **Active campaigns** table above.

## Folder structure

```
_CAMPAIGNS/
  README.md           <- this file (master index)
  GM_PERSONA.md        <- shared GM voice/table preferences + Core GM Commitments
  HOUSE_RULES.md       <- living log of custom rules, applies to all campaigns by default
  SESSION_PROTOCOL.md  <- pre-session and post-session checklists
  _TEMPLATE/           <- blank starter kit, copy this to create a new campaign
  <Campaign Name>/      <- one folder per campaign
  ...

../_TOOLS/
  dice.py                            <- roll everything through this, never narrate a result
  GM_QUICK_REFERENCE.md              <- condensed core rules for mid-session lookups
  ENCOUNTER_TREASURE_REFERENCE.md    <- encounter difficulty & reward calibration
```

*(Note: this is the reference copy kept in the app's repo, under `gm-brain/`. The original source lives locally in the `Shadowdark/_CAMPAIGNS` folder, including per-campaign data like session history and character sheets, which is intentionally not duplicated here.)*
