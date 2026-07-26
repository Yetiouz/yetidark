# Delve — GM app prototype

A click-through prototype of the three screens we designed: campaign lobby,
live game table (dice, hex fog-of-war map, group voting), and GM dashboard.
Everything runs on mock data in `src/mockData.js` — no login, no server, no
database yet. This is meant to get a real link in front of your friends fast
so you can react to the design before we wire up accounts and live sync.

## Try it on your own machine first (optional)

If you have Node.js installed:

```
cd gm-app
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Deploy it so your friends can open a link

You said you have GitHub — here's the fastest path from here, no terminal
required if you'd rather avoid it.

### Option A: no terminal, all in the browser

1. Go to github.com, click **New repository**, name it `gm-app`, keep it
   public or private (either works), and create it.
2. On the new repo's page, click **uploading an existing file** and drag in
   every file and folder from this `gm-app` folder (keep the folder
   structure — `src/` should stay a folder, not get flattened).
3. Commit the upload.
4. Go to vercel.com, sign up (free, "Continue with GitHub" is easiest), then
   click **Add New → Project**, pick the `gm-app` repo, and click **Deploy**.
   Vercel auto-detects Vite and handles install + build itself.
5. In a minute or two you'll get a live URL like `gm-app.vercel.app` — send
   that to your friends.

### Option B: with terminal

```
cd gm-app
git init
git add .
git commit -m "Initial prototype"
git branch -M main
git remote add origin https://github.com/<your-username>/gm-app.git
git push -u origin main
```

Then same as Option A steps 4–5 on vercel.com.

Every time you want to push an update: commit and `git push` (or re-upload
via the GitHub website) — Vercel redeploys automatically.

## What's next after this deploys

This prototype has no real accounts or shared state yet — everyone who
opens the link sees the same mock data, and nothing you click persists or
syncs between people. Once you've clicked through it with your friends and
we're happy with the design, the next step is wiring up:

- **Supabase** (supabase.com, free tier) for login and a Postgres database,
  plus its realtime feature so everyone in a session sees updates live
  (HP changes, dice rolls, hex reveals) without refreshing.
- Swapping `src/mockData.js` for real Supabase queries.
- An AI GM mode that reads campaign state and narrates/responds like a
  human GM would.

Happy to build that out next whenever you're ready.
