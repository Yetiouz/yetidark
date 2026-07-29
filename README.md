# Delve

Delve is a multiplayer web app for running Shadowdark RPG campaigns with a
human or AI game master. It uses React and Vite for the frontend and Supabase
for authentication, Postgres, storage, realtime updates, and Edge Functions.

Production: https://yetidark.vercel.app/

## Local development

Requirements:

- Node.js 22
- pnpm 11.9.0
- Docker, when running the local Supabase stack

Create your local browser configuration:

```sh
cp .env.example .env.local
```

Fill in the public Supabase project URL and anon key, then install and start the
app:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Verification

Run the same dependency audit and production build used by continuous
integration:

```sh
pnpm verify
```

To rebuild and test the database locally:

```sh
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm exec supabase db lint --level error
```

## Delivery

Pull requests and pushes to `main` run the verification workflow. Vercel builds
the frontend from `main`; `vercel.json` applies the production browser security
headers.
