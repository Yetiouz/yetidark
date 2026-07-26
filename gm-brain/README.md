# GM Brain — reference copy

This folder is a **copy** of the file-based GM system used to run Shadowdark campaigns via Claude chat (originally kept locally in the `Shadowdark/_CAMPAIGNS` and `Shadowdark/_TOOLS` folders). It's included here so the app's future AI-GM integration has the actual source material to build against, in version control alongside the code that will eventually replace parts of it with real database tables.

**What's here:** the GM's own tooling and writing — `dice.py`, the condensed rules-quick-reference sheets, the GM persona/house-rules/session-protocol docs, and blank campaign templates.

**What's deliberately NOT here:** the actual Shadowdark rulebook PDFs, Cursed Scroll zines, and adventure maps. Those are purchased, copyrighted commercial products — this repo is public, so they don't belong in it. The private `rule_documents` upload feature (Supabase, private storage bucket) is the intended home for that material once it's built.

**Not yet copied:** `tracker.xlsx` (NPC/faction/treasure tracker) — it's a binary spreadsheet that couldn't be read out of the source OneDrive folder in this session (cloud-sync placeholder issue). Its columns (PC Roster, NPCs, Factions, Treasure & Magic Items, Session Index) are documented in `_CAMPAIGNS/_TEMPLATE/README.md` below and will inform the NPC/treasure tracker schema chunk later.

See `../CLAUDE_CONTEXT.md` for where this fits in the overall Delve project.
