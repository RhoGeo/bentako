# POSync → Supabase Migration (No Base44)

This repo was originally a Base44 app. This migration removes Base44 and replaces the backend with **Supabase Postgres + Supabase Edge Functions**.

## 1) Create Supabase project
- Create a new project in Supabase.

## 2) Create schema
- Open **SQL Editor** in Supabase.
- Run the migration SQL:
  - `supabase/migrations/001_posync_schema.sql`

## 3) Deploy Edge Functions (Auth + First Store)
This repo includes Edge Functions for:
- `authSignUp`
- `authSignIn`
- `authMe`
- `authSignOut`
- `createFirstStore`

### Requirements
- Install Supabase CLI.
- Link your project.

### Set secrets
These functions use the service role key (server-side only):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Example:
```bash
supabase secrets set SUPABASE_URL="https://<project-ref>.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

### Deploy
These functions require **verify_jwt = false** (custom token auth), already set via each function's `config.toml`.

```bash
supabase functions deploy authSignUp
supabase functions deploy authSignIn
supabase functions deploy authMe
supabase functions deploy authSignOut
supabase functions deploy createFirstStore
```

## 4) Configure the client
Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Set:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Run:
```bash
npm install
npm run dev
```

## 5) Next (port the remaining endpoints)
The UI still references many prior Base44 entity calls.

Search for:
- `base44.entities`

Replace them with:
- Dexie cached reads (`src/lib/db/*`)
- Edge Functions via `invokeFunction(...)`

The quickest path is to port the existing Base44 Deno functions in `/functions/` into Supabase Edge Functions under `supabase/functions/`.
