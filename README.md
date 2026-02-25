# Bentako POS (Supabase)

This repo was originally generated as a Base44 project. It has been updated to use **Supabase** for:
- Auth (email/password)
- Database reads/writes via PostgREST
- Edge Functions via `supabase.functions.invoke(...)` (optional, for your offline sync + POS workflows)

## 1) Prerequisites

- Node.js 18+
- A Supabase project already created (you said you already have this ✅)

## 2) Configure environment variables

Create **`.env.local`** in the project root:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

Get these from: **Supabase Dashboard → Project Settings → API**.

## 3) Install + run

```bash
npm install
npm run dev
```

> Note: this repo intentionally does **not** include `package-lock.json` so you can regenerate a clean lock after removing Base44 deps.

## 4) Where to edit table mappings

The app still calls `base44.entities.<Entity>` in many places.
To avoid rewriting everything, `src/api/base44Client.js` now provides a **Supabase-backed compatibility layer**.

If your Supabase table names differ, edit this object:

- `src/api/base44Client.js` → `ENTITY_TABLE_MAP`

Example:

```js
export const ENTITY_TABLE_MAP = {
  Product: "products",
  Customer: "customers",
  // ...
}
```

## 5) Login

A simple login page is available at:

- `/login`

It uses `supabase.auth.signInWithPassword` and `supabase.auth.signUp`.

## 6) Edge Functions (optional)

If your app uses offline sync, it will call these via `supabase.functions.invoke`:

- `pushSyncEvents`
- `pullSyncEvents`

…and other POS helpers like `completeSale`, `barcodeLookup`, etc.

If you already deployed equivalents in Supabase Edge Functions, keep the same names.
Otherwise, you can temporarily disable auto-sync or stub the functions.
