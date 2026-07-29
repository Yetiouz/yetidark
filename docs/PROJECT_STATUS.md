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
| Rebuild a clean database | Complete | Local rebuild applies migrations 001–025 successfully. |
| Lockfile and environment example | Complete | pnpm lockfile, pinned package manager, and `.env.example` are checked in. |
| Build verification and CI | Substantially complete | Dependency audit, rules tests, production build, and GitHub Actions are present. Dedicated formatting, linting, and type-checking remain optional follow-up work. |
| RLS and storage tests | Substantially complete | The 104-test database suite is on `main`. Continue adding tests with each command or policy. |
| Protect discovery data and maps | Complete | Public discovery uses safe data boundaries; maps are private and served with authorized signed URLs. |
| Separate GM secrets | Complete for current trackers | NPC, faction, and treasure secrets are stored separately with GM-only access. |
| Versioned rules module | Complete for character rules | Character rules are versioned and covered by focused tests. |
| Correct audited character rules | Complete for the audited set | Starting HP, roll provenance, gear slots, equipped gear, talent rolls, spell cycles, and full rests are implemented. |
| Campaign event ledger | In progress | The ledger records HP, XP, coin, and full rests in production. Gear, spell, clock, and light commands remain. |
| Authoritative app dice and identity | Not complete | Identity protections exist, but app-generated dice still originate in the browser. |
| URL routing and session restoration | Not started | Navigation still relies on React state and is lost on refresh or shared links. |

## Live production baseline

Production currently includes database migrations through **025**:

- reproducible schema and aligned migration history
- authorization and cross-campaign integrity hardening
- serialized AI-GM turn claims
- separated GM tracker secrets
- private campaign maps
- versioned character-creation roll provenance
- standing talent rolls
- spell success/lock cycles
- atomic full rest with ration consumption
- append-only campaign events for HP, XP, coin, and full rests

## Recommended next sequence

1. Extend authoritative ledger commands to gear and spell mutations.
2. Extend commands to campaign clocks and light sources.
3. Move browser-generated dice behind a trusted server command.
4. Add URL routing and restore campaign/character context after refresh.
5. Run a structured multiplayer playtest before beginning a larger AI-GM
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
