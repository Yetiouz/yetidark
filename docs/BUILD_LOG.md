# Delve build log

This log records the major construction stages of Delve. It is intentionally
grouped by outcome rather than listing every small corrective commit. Git
history remains the detailed source of truth.

## July 25, 2026 — Prototype begins

- Created the initial dark-themed Shadowdark application prototype.
- Established the first player, GM, map, and campaign interface concepts.

## July 26, 2026 — Working multiplayer foundation

- Added magic-link authentication and the account profile.
- Added campaign creation, public/private discovery, join codes, membership,
  and player/GM roles.
- Added character creation, selection, sheets, portraits, gear, talents, XP,
  coin, backgrounds, and features.
- Replaced mock campaign play with Supabase-backed data.
- Added map upload, hex overlay, GM-controlled fog of war, and party position.
- Added realtime scene log, party chat, dice results, turn order, votes,
  encounters, monsters, and GM notes.
- Added campaign settings, house rules, threads, clocks, timeline, light
  tracking, rules library, and NPC/faction/treasure trackers.
- Added the initial AI-GM Edge Function and table conversation flow.
- Added the original project handoff document and GM-brain reference material.

## July 27, 2026 — Play experience and AI iteration

- Fixed public joining and realtime feedback issues.
- Added AI-GM debounce and duplicate-response protections.
- Added retry handling and clearer Edge Function errors.
- Added map zoom and pan.
- Added spells, core classes and ancestries, class features, and armor-class
  calculation.

## July 28, 2026 — Builders and Milestone 0 audit

- Expanded class support with Cursed Scroll material.
- Rebuilt character and campaign creation as guided step-by-step flows.
- Added the campaign staging lobby.
- Refined the fixed player-table and GM-dashboard layouts.
- Completed the Milestone 0 audit at commit `d7eb09b`.
- Confirmed that the current stack should be preserved.
- Identified database reproducibility, authorization, rules correctness,
  authoritative commands, routing, and delivery safety as the stabilization
  priorities.

## July 28–29, 2026 — Reproducibility and delivery

- Reconstructed the current live Supabase schema as a reproducible migration
  chain.
- Aligned migration identifiers with production.
- Added Supabase CLI configuration and repeatable local rebuild instructions.
- Added a deterministic pnpm lockfile and public environment example.
- Added dependency auditing, rules tests, production build verification, and a
  GitHub Actions gate.
- Added production browser security headers and adopted preview-branch/pull-
  request delivery.

## July 28–29, 2026 — Security hardening

- Restricted campaign discovery and joining boundaries.
- Hardened campaign membership, campaign creation, identity attribution, scene
  logs, dice audit links, avatars, rules files, and cross-campaign references.
- Serialized AI-GM turn generation to prevent concurrent duplicate narration.
- Split NPC, faction, and treasure secrets into GM-only records.
- Made campaign map storage private and replaced public URLs with authorized
  signed access.
- Expanded database authorization and storage-policy tests.

## July 29, 2026 — Shadowdark rules stabilization

- Added a versioned character rules module and focused rules tests.
- Persisted raw ability rolls, starting HP rolls, applied rules version, and
  character-creation provenance.
- Corrected starting HP and gear-slot behavior.
- Applied the equipped-items house rule.
- Made class talent results stand and retain their roll provenance.
- Implemented the approved per-rest spell success and lock cycle, including
  natural-1 mishaps.
- Added atomic full rests that consume a ration, restore HP and daily features,
  and reset spell-cycle state.

## July 29, 2026 — Event ledger foundation released

- Added an append-only campaign event table in migration 025.
- Added an authoritative command for HP, XP, and coin adjustments.
- Recorded authenticated actors, before/after values, requested and applied
  deltas, reasons, and full rests.
- Raised the database test suite to 104 passing checks.
- Applied and verified migration 025 in production.

## July 29, 2026 — Frontend lint gate prepared

- Added React-aware ESLint checks for application code, hooks, tests, and
  configuration files.
- Added linting to the same verification command used locally and by GitHub
  Actions.
- Removed unused character-selection state, an unused tracker import, and an
  unused character-builder setter identified by the first lint pass.
- Kept React compiler migration rules out of the initial gate so existing
  loading effects and map interactions can be modernized in focused changes.

## July 29, 2026 — Atomic character creation released

- Replaced separate character, gear, talent, and feature writes with one
  authoritative database transaction.
- Derived character ownership from the authenticated user and required campaign
  membership inside the command.
- Added a `character.created` campaign event with starting-record counts.
- Proved that invalid child records roll back the entire character and that
  direct character inserts cannot bypass the command.
- Rebuilt the local database through migration 029 and passed all 152 database
  authorization tests.
- Applied migration 029 to production and verified that the local and remote
  migration ledgers match with no pending database changes.
