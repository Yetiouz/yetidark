# Delve multiplayer playtest

Use this checklist to close stabilization and establish the baseline for
Milestone 1. Run it with two different accounts in separate browser sessions:
one campaign GM and one player.

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

## Results

Record each failure with:

- account role
- page URL
- expected behavior
- actual behavior
- whether a refresh changes the result
- screenshot or console error when useful

The stabilization milestone passes when every access-control check passes and
the shared scene, roll, state change, event history, and resume flow complete
without a release-blocking defect.
