# Delve multiplayer playtest

This checklist closed stabilization and established the baseline for Milestone
1. It was completed on July 29, 2026 with two different accounts in separate
browser sessions: one campaign GM and one player.

## Goal

Prove that two people can enter the same campaign, use durable URLs, play one
short scene, apply trusted state changes, and resume without losing state or
crossing role boundaries.

## Preparation

- Use a dedicated test campaign rather than an active campaign.
- Name it clearly and avoid entering real secrets.
- Give the player a separate GitHub account and browser session.
- Keep the database and browser consoles available for observing failures, but
  do not edit production rows by hand.
- Record the campaign URL and the two character URLs.

## Pass 1 — Access and routing

- [ ] GM signs in with GitHub and creates or opens the test campaign.
- [ ] Player signs in with GitHub and joins through the intended invite flow.
- [ ] Both users refresh the campaign URL and return to the same campaign.
- [ ] Each user opens their character URL in a new tab.
- [ ] Player can open the campaign's settings view but cannot edit or save
      GM-controlled settings.
- [ ] Player cannot see the join password, GM notes, secret tracker fields, or
      unpublished map information.
- [ ] GM can still open campaign settings and GM-only information.

## Pass 2 — Shared session

- [ ] GM starts or resumes the session.
- [ ] Player enters the game table and sees the current scene.
- [ ] GM changes the visible scene or party position.
- [ ] Player receives the change without refreshing.
- [ ] Player sends one chat or scene-log message.
- [ ] GM sees the message once, with the correct player identity.
- [ ] GM advances one clock or light state.
- [ ] Player sees the authoritative update.

## Pass 3 — Character and dice

- [ ] Player makes one app-generated roll.
- [ ] Both users see the same result and roller identity.
- [ ] The result cannot be edited into a different authoritative total.
- [ ] Apply one HP, XP, or coin change with a short test reason.
- [ ] Both users see the new value.
- [ ] Refresh both browsers and confirm the value persists.
- [ ] Confirm the campaign event history identifies the actor, reason, previous
      value, and new value.

## Pass 4 — Pause and resume

- [ ] Leave the campaign from both browsers.
- [ ] Reopen the saved campaign URL.
- [ ] Confirm the current scene, light/clock state, character state, and recent
      activity remain intact.
- [ ] Confirm GM and player return to role-appropriate screens.

## Results — passed

- Separate GM and player accounts entered the same production campaign through
  GitHub sign-in.
- Campaign, character, player-table, and GM routes restored from durable URLs.
- A player attempting the GM route was redirected to the player table.
- Realtime chat appeared once with the correct player identity.
- An app-generated roll appeared once with the same result and identity on both
  screens.
- A reasoned HP change synchronized, survived refresh, and produced an
  authoritative event with the correct before value, after value, and reason.
- A clock was stored once and was readable by the player through Campaign Log.
- A GM map/party-state change appeared on the player table without refresh.
- Campaign, character, clock, map, chat, and roll state survived leaving and
  reopening the session.

The existing database authorization suite remains the proof for GM-secret,
cross-campaign, storage, and direct-write boundaries that are not safely tested
by attempting hostile production writes.

## Defects found and resolved

- Players could not enter an already-live human-GM session because re-entry was
  incorrectly gated by the GM-only first-start rule. Fixed in PR #25.
- HP, XP, and coin changes did not collect the reason already supported by the
  event ledger. Fixed in PR #26.
- Clock and light command responses could be rendered a second time when their
  realtime inserts arrived. The database contained only one row. Fixed in PR
  #27.

## UI follow-up

Shared clocks and other campaign state are available through Campaign Log, but
the icon-only entry point is too difficult to discover during play. Milestone 1
will decide which clocks, light state, objectives, and recent authoritative
events belong directly on the player table.

## Future playtests

Record each failure with:

- account role
- page URL
- expected behavior
- actual behavior
- whether a refresh changes the result
- screenshot or console error when useful

The stabilization milestone passed after the release-blocking defects above
were fixed and verified.
