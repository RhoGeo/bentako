# Supabase Edge Functions (No Worker) - Quick Start

These functions avoid Node-only libs and do **not** use `Worker`, so they work reliably in Supabase Edge runtime.

## 1) Set secrets

```bash
supabase secrets set SUPABASE_URL="https://<project-ref>.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
```

## 2) Deploy

```bash
# Auth + onboarding
supabase functions deploy authSignUp
supabase functions deploy authSignIn
supabase functions deploy authMe
supabase functions deploy authSignOut
supabase functions deploy createFirstStore

# Catalog (Items/ProductForm)
supabase functions deploy listProducts
supabase functions deploy getProduct
supabase functions deploy listProductVariants
supabase functions deploy upsertProduct
supabase functions deploy deleteProduct
supabase functions deploy barcodeLookup

# Customers (Utang)
supabase functions deploy createCustomer
supabase functions deploy pushSyncEvents
supabase functions deploy pullSyncEvents
supabase functions deploy getCustomerLedger

# Reports / History
supabase functions deploy listSales
supabase functions deploy saleDetails
supabase functions deploy getInventoryMetrics
supabase functions deploy listStockLedger
supabase functions deploy acknowledgePolicy

# Store + Staff management (optional but recommended)
supabase functions deploy listMyStores
supabase functions deploy createStore
supabase functions deploy archiveStore
supabase functions deploy unarchiveStore
supabase functions deploy deleteStore
supabase functions deploy updateStoreSettings
supabase functions deploy setOwnerPin
supabase functions deploy updateStorePermissions
supabase functions deploy listStoreMembers
supabase functions deploy addStaffByEmail
supabase functions deploy updateStoreMember
supabase functions deploy assignStaffToStores
supabase functions deploy inviteStaff
supabase functions deploy listStaffInvites
supabase functions deploy revokeStaffInvite
supabase functions deploy acceptStaffInvite
```

## 2.1) Required DB migration

This repo's offline-first sync requires RPCs + a few helper columns.

Run migrations (or paste into the SQL editor):

```bash
supabase db push
```

If you are applying manually, make sure `supabase/migrations/002_posync_sync_rpc.sql` is applied.

## 3) Client calls
Client should call: `POST https://<project-ref>.supabase.co/functions/v1/authSignUp`
with headers:
- `apikey: <anon>`
- `authorization: Bearer <anon>`
- (optional) `x-posync-access-token: <access_token>`

