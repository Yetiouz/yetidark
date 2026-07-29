# Delve project status

**Updated:** July 29, 2026
**Production:** https://yetidark.vercel.app
**Repository:** `Yetiouz/yetidark`

This is the short operational handoff for Delve. `BUILD_LOG.md` contains the
chronological history, while the original Milestone 0 audit remains the source
for the stabilization goals.

## Current state

Delve is a working multiplayer Shadowdark campaign application. Authentication,
campaigns, characters, player and GM tables, maps and fog, realtime activity,
campaign management, rules references, trackers, and the first AI-GM workflow
all use Supabase-backed production data.

The current architecture remains appropriate:

- React 18 and Vite frontend
- Supabase Auth, Postgres, Storage, Realtime, and Edge Functions
- Vercel production deployment
- GitHub pull-request workflow with automated verification

## Stabilization milestone status

| M0.5 item | Status | Notes |
|---|---|---|
| Reconcile live Supabase schema | Complete | Migration chain now represents the live application schema. |
| Rebuild a clean database | Complete | Local rebuild applies migrations 001–029 successfully. |
| Lockfile and environment example | Complete | pnpm lockfile, pinned package manager, and `.env.example` are checked in. |
| Build verification and CI | Complete for the current JavaScript app | Dependency audit, linting, rules tests, production build, and GitHub Actions run through one verification command. Formatting and static typing remain optional follow-up work. |
| RLS and storage tests | Substantially complete | The 152-test database suite is on `main`. Continue adding tests with each command or policy. |
| Protect discovery data and maps | Complete | Public discovery uses safe data boundaries; maps are private and served with authorized signed URLs. |
| Separate GM secrets | Complete for current trackers | NPC, faction, and treasure secrets are stored separately with GM-only access. |
| Versioned rules module | Complete for character rules | Character rules are versioned and covered by focused tests. |
| Correct audited character rules | Complete for the audited set | Starting HP, roll provenance, gear slots, equipped gear, talent rolls, spell cycles, full rests, and atomic character creation are implemented. |
| Campaign event ledger | Complete for the audited mutations | HP, XP, coin, full rests, gear, spells, clocks, light, dice, and character creation use authoritative commands and events. |
| Authoritative app dice and identity | Complete for current app dice | App-generated dice and actor identity are derived by trusted database commands. |
| URL routing and session restoration | In review | PR #18 adds URL-backed navigation, refresh restoration, route tests, and the Vercel SPA rewrite. Signed-in preview verification remains. |

## Routing preview handoff

PR #18 (`codex/url-session-routing`) passed the dependency audit, 11 rules
tests, 5 routing tests, the production build, and direct preview checks for
every application route. Direct route loads and browser back/forward navigation
retain the requested URL.

Complete these signed-in checks before merging:

1. Open an existing campaign, refresh a campaign screen, and confirm the
   campaign and screen are restored.
2. Copy a campaign or character URL into a new tab and confirm the authorized
   destination opens. Confirm a player cannot remain on the GM route.

Supabase temporarily allows the exact PR preview origin
`https://yetidark-2ox82i8mh-yeti5.vercel.app` for magic-link testing. Remove
that redirect after PR #18 is merged or the preview is retired.

## Live production baseline

Production currently includes database migrations through **029**:

- reproducible schema and aligned migration history
- authorization and cross-campaign integrity hardening
- serialized AI-GM turn claims
- separated GM tracker secrets
- private campaign maps
- versioned character-creation roll provenance
- standing talent rolls
- spell success/lock cycles
- atomic full rest with ration consumption
- append-only campaign events and commands for audited state mutations
- trusted server-side app dice
- atomic character creation with rollback protection

## Recommended next sequence

1. Complete signed-in verification and merge URL routing.
2. Merge the route-level code-splitting follow-up.
3. Run a structured multiplayer playtest before beginning a larger AI-GM
   milestone.

## Working rules

- Never edit production data during inspection.
- Keep every database change in a numbered migration.
- Rebuild and run database authorization tests before applying a migration.
- Use preview deployments and pull requests for meaningful changes.
- Treat direct browser writes to important game state as migration candidates
  for authoritative commands and ledger events.
- Keep secrets out of the repository. Only public browser configuration belongs
  in `.env.example`.
