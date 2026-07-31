# Delve roadmap

Updated: July 31, 2026

This is the single milestone list for Delve going forward. It replaces the
competing milestone numbering that had built up across several planning
documents in the design folder (OneDrive `Shadowdark/`) which disagreed with
each other and with what actually shipped. See "Superseded documents" below
for exactly what changed and why.

For day-to-day status, keep using `docs/PROJECT_STATUS.md` (operational
snapshot) and `docs/BUILD_LOG.md` (chronological history). This file is the
forward plan those two feed into.

## Where we are

M0.5 stabilization is complete (see `docs/PROJECT_STATUS.md` and the closing
playtest in `docs/MULTIPLAYER_PLAYTEST.md`). The foundation — auth,
campaigns/membership, character creation and sheets, gear/inventory, lobby,
basic session orchestration, authoritative dice, realtime sync, light/rest,
and a first player-table status rail (objective/clocks/light) — is built and
deployed. Nothing below needs new infrastructure: same Vercel frontend, same
Supabase backend (Postgres + Auth + Storage + Realtime + Edge Functions), no
microservices.

## Two tracks, run together

**Track A — visual redesign.** The current UI is functional but plainer than
the reference direction in `App Design/delve-ui-reference/` (shared visual
language: near-black background, charcoal panels, blue/green/purple/amber
color meanings, shared status chips and activity strips). Rather than a
separate redesign milestone, apply this pass to whichever screen Track B is
about to touch, mockup-first, so screens aren't built twice.

**Track B — systems and screens**, below, in dependency order.

## Milestone 1 — Harden the vertical gameplay loop

The biggest functional gap: `turn_order` is a mutable JSON list today, not a
real encounter engine. Build clockwise initiative (highest d20+DEX starts,
order proceeds clockwise, surprise grants a new roll), Close/Near/Far zones,
one action plus Near movement, attacks/damage, dying (1d4+CON death timer,
natural-20 recovery), stabilizing (DC 15 INT at Close range), and morale (DC
15 WIS at half-group/solo HP).

Screens: 01 Player Session, 03 GM Session (encounter portions), 10 Encounter
Mode.

Acceptance case: run the existing Bjorn/Allindra test campaign's bull-statue
scene end to end — approach, triggered encounter, combat, resolution.

Complete when initiative stays clockwise (not a ranked tracker), HP changes
are auditable through the event ledger, and the GM's player-view preview
exactly matches what players see.

## Milestone 2 — Spellcasting and advancement

Spell state (`successful_since_rest`, `locked_until_rest`, mishap/penance)
already exists in the database from M0.5; this builds the Spellbook screen
against it correctly. Advancement turns the raw XP counter into a real
level-up: current-level-times-10 XP threshold, XP resets to zero, one class
hit die to max HP (no CON), talent rolls at levels 1/3/5/7/9 only.

Screens: 15 Spellbook, 20 Character Advancement (with the correction below
applied), reward portion of 08 End-Session Review.

Correction to apply before building: the reference mockup's Bjorn
level-1-to-2 example is rules-incorrect as drawn — it shows a talent roll at
level 2 (should be none), HP gain with CON added (should be flat `1d8`, no
CON), and a Sea Wolf talent option that includes DEX (the actual talent is
`+2 STR or CON, or +1 attacks`). Fix the numbers before implementing, not
after.

Complete when a level-1 Sea Wolf advances to level 2 correctly, a level-2
character receives no talent roll, and the spell-lockout screen matches the
house rule exactly (pre-success failures don't lock; natural 1 always
triggers the mishap table regardless).

## Milestone 3 — Campaign continuity

No end-of-session reconciliation, journal, or snapshot exists yet; this
surfaces the event ledger that's already being written.

Screens: 08 End-Session Review, 09 Campaign Journal, 14 NPC and Faction
Manager (add edit-in-place, currently add/delete only; add a World/Codex
page for places, which nothing currently covers).

Complete when ending a session produces a timeline entry, current-state
snapshot, and next-session pickup point together, and a restored snapshot
doesn't destroy the original event history.

## Milestone 4 — GM prep tools

Screens: 12 Adventure Workspace, 13 Map Management (full version — walls,
doors, per-area lights, triggers), 19 Handouts and Media.

Complete when a GM can prepare a scene (e.g. the Lost Citadel's Northeast
Hall) without external notes, every secret has an explicit visibility state,
and revealed handouts persist in the journal.

## Milestone 5 — AI GM supervision

Deliberately last: stabilize human-run systems first, then give the AI the
same validated command interface rather than a separate rules path.

Screens: 17 AI GM Supervision, AI-specific portions of 03 GM Session and 21
Campaign Settings.

Complete when the AI cannot expose GM secrets, cannot bypass mutation
validation, and a human can take over mid-session without losing state.

## Milestone 6 — Hardening and launch

Responsive layouts, accessibility pass, rate limits/abuse prevention, backup
and restore drills, monitoring. Dice History (18) and the full Party
Management (16) screen are small enough to ride along with whichever
milestone above is convenient rather than needing their own slot.

## Small independent items (no design discussion needed)

Carried forward from an earlier code read that's otherwise stale (see
below) but still confirmed true against current code:

- `HexMap.jsx` is dead code (an earlier hex-grid prototype, not imported
anywhere) — safe to delete.
- Native `window.prompt`/`window.confirm` dialogs (monster AC/HP entry,
clock segments, light-source minutes, delete confirmations) could become
styled inline forms — cosmetic, not urgent.

Anything else from that old bug list should be re-verified against current
code before acting on it — several of its items (GM dashboard missing
rules-library/tracker buttons, equipped-gear slot math, background
roll-or-pick) turned out to already be fixed when checked.

## Superseded documents

Four planning documents exist in the OneDrive `Shadowdark/` folder. Here's
what's still trustworthy and what isn't:

- `App Design/delve-ui-reference/MILESTONE_0_AUDIT.md` — this is what M0.5
actually implemented; its findings match what shipped. Historical record,
accurate.
- `App Design/delve-ui-reference/README.md` — the 21 reference screens and
shared visual language are still the design target. Its own "recommended
implementation order" (build screens 1-21 roughly in that sequence) is
superseded by the milestone list above, which groups screens by shared
system dependency instead.
- `App Design/delve-ui-reference/STREAMLINED_BUILD_PLAN.md` — its own
Milestone 0-10 numbering is superseded by this file. Its idea of using the
Bjorn/Allindra campaign as the acceptance case for each milestone is kept
(see Milestone 1 above).
- `App Design/delve-ui-reference/SYSTEM_ARCHITECTURE_AND_RULES_MATRIX.md` —
its proposed 4-deployable/microservices-adjacent architecture is rejected;
the app stays on one Vercel frontend and one Supabase backend. Its rules
matrix, 22-logical-system breakdown, and "corrections required before
coding" section (spell lockout state model, advancement corrections) remain
accurate and are referenced above.
- `Delve_Roadmap_and_UI_Audit.md` — the oldest of the four, read against an
11-migration snapshot of the code. Largely stale now; do not act on its bug
list without re-verifying against current code first.

## Working process

Structural/backend changes (migrations, data wiring): build directly,
open a PR, verification steps that need a local Supabase instance get
called out explicitly rather than assumed.

Visual/design changes: mockup first, confirm, then build.

Every milestone above gets a design pass (Track A) on whichever screens it
touches before or during the build, not after.
