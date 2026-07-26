# Delve — GM app prototype

A click-through prototype of the screens we've designed: sign-in, campaign
lobby, character picker, live game table (dice, hex fog-of-war map, group
voting), and GM dashboard. Everything runs on mock data in `src/mockData.js`
— no real accounts, no server, no database yet.

Live at: https://yetidark.vercel.app/

## Try it on your own machine (optional)

```
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Deploying

Already connected to Vercel — every push to `main` redeploys automatically.

## What's next

This prototype has no real accounts or shared state yet. Next steps:

- **Supabase** for real email magic-link auth, a Postgres database, and
  realtime sync so everyone in a session sees updates live (HP changes,
  dice rolls, hex reveals) without refreshing.
- Swapping `src/mockData.js` for real Supabase queries.
- A real Shadowdark character builder (roll stats, pick ancestry/class)
  behind the "Start rolling" button in the character picker.
- An AI GM mode.
