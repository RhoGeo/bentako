# POSync Manual Acceptance Tests

> Run locally:
>
> ```bash
> npm install
> npm run dev
> ```

## Fast Checkout (Scan-first)

1. **Counter → Scan Mode → scan 5 different barcodes quickly**
   - Expected: cart increments without closing scanner.
2. **Scan same barcode 3x**
   - Expected: qty becomes **+3**.
3. **Hardware wedge**
   - Counter: focus search input → scan on hardware scanner → **Enter**
   - Expected: item auto-adds (toggle “Auto-add on Enter” default ON).
4. **Not found**
   - Scan an unknown barcode
   - Expected: stays in scanner modal; shows “Barcode not found” + actions **Try Again** / **Add New Item**.
   - Add New Item → ProductForm opens with barcode prefilled.

## BarcodeScannerModal (Step 6) — Camera + Torch + Manual Fallback

1. **Permission denial fallback**
   - In browser/site settings: block camera permission for the app domain.
   - Open Counter → Scan Mode.
   - Expected:
     - UI shows “Walang camera permission”
     - Manual entry UI is available and can submit a barcode.

2. **Torch toggle (if supported)**
   - On a phone with torch capability, open Scan Mode.
   - Tap the ⚡ torch icon.
   - Expected: flashlight toggles ON/OFF (no crash if unsupported).

3. **Continuous scan does not close**
   - Scan 3 different barcodes.
   - Expected: scanner stays open until Done.

4. **Overlay updates (optional)**
   - On Counter, after each scan:
   - Expected: modal shows last scanned and Cart count; Total ₱ appears.

## Items + Add/Edit Product + Variants (Step 8)

### Items screen scan behavior

1. Go to **Items** tab.
2. Tap the **scanner icon** on the search bar.
3. Scan a barcode that exists in the store.
   - Expected: app opens **ProductForm (Edit)** for that item.

4. Scan a barcode that does **not** exist.
   - Expected:
     - Scanner stays open
     - Shows **Barcode not found** panel
     - Tap **Add New Item** → opens **ProductForm (New)** with `barcode` prefilled.

### ProductForm scan-fill behavior

1. Go to **Items → +** (new product) or open an existing product.
2. Tap the **scanner icon** beside the **Barcode** input.
3. Scan a barcode.
   - Expected: barcode field is filled automatically.

### Variant scan-fill behavior

1. Create/Edit a **Parent w/ Variants**.
2. Tap **Add Variant**.
3. Tap the scanner icon on the variant’s **Barcode** input.
4. Scan a barcode.
   - Expected: that variant row’s barcode field is filled.

### Barcode uniqueness enforcement (per store, sellable only)

1. In ProductForm, set barcode to an existing sellable item’s barcode in the same store.
2. Tap **Save**.
   - Expected: **Save blocked** with a clear error: “Barcode already used in this store”.

3. For Parent w/ Variants:
   - Give two variants the same barcode (either manual or scan the same barcode twice).
   - Tap **Save**.
   - Expected: **Save blocked** with “Duplicate barcode in form”.

## Offline (REAL)

1. Turn on **Airplane mode**.
2. Counter: scan a cached product
   - Expected: resolves via Dexie `[store_id+barcode]` index and adds.
3. Complete sale offline
   - Expected:
     - A row is created in **IndexedDB → posync_v2 → offline_queue** (status `queued`)
     - A row is created in **local_receipts** (local_status `queued`)
4. Turn internet **back ON**
   - Expected:
     - Sync runs automatically and/or via “Sync Now”
     - queued event becomes `applied` / `duplicate_ignored`
     - `local_receipts.server_receipt_number` is filled
     - No duplicate sales created on server

## Offline DB (Dexie) + Session Persistence (Step 4)

### Dexie schema matches required tables/indexes

1. Open DevTools → Application → IndexedDB → **posync_v2**
2. Confirm these tables exist:
   - `cached_products`, `cached_customers`, `cached_categories`
   - `offline_queue`, `local_meta`, `local_receipts`
3. Confirm `offline_queue` rows contain required fields:
   - `event_id`, `store_id`, `device_id`, `event_type`, `payload_json`, `created_at_device`, `status`, `attempt_count`, `last_error`, `client_tx_id`

### Session survives reload (PWA refresh)

1. Complete **Sign In** (Step 7 adds UI; until then, you can run the server curl Sign In and paste token into localStorage).
2. In DevTools → Application → Local Storage:
   - Confirm `posync_session_v1` exists and contains `access_token`.
3. Confirm Dexie global auth snapshot:
   - IndexedDB → posync_v2 → `local_meta` row for key `["__global__", <device_id>]` has:
     - `auth_json` and `user_json`
4. Refresh the page.
   - Expected:
     - Session is restored from localStorage
     - App calls `authMe` on boot
     - User remains authenticated (no forced re-login)

## SyncManager (Client — Step 5)

### Auto-sync triggers

1. With app open and a valid store selected, turn **Airplane mode ON**.
2. Perform any action that queues an event (e.g., queue a restock or complete sale offline).
   - Expected: a row appears in `IndexedDB → posync_v2 → offline_queue` with `status=queued`.
3. Turn Airplane mode **OFF**.
   - Expected: within a few seconds, the queued event transitions:
     - `queued → pushing → applied` (or `duplicate_ignored`)

Trigger sources implemented:
- app start (`startAutoSync` runs once)
- network regain (`window:online`)
- after queueing (`window:posync:offline_event_enqueued`)
- manual button (Sync Now)

### Push batching + per-event statuses

1. Queue 3+ offline events quickly (e.g., 3 restocks or 3 payments).
2. Go to **More → Sync** (page: `SyncStatus`).
3. Tap **Sync Now**.
   - Expected:
     - events marked `pushing` before request
     - then updated to `applied` / `duplicate_ignored` / `failed_retry` / `failed_permanent`
     - failed_retry increments `attempt_count`

### Pull cursor-based updates

1. Go online and tap **Sync Now**.
2. In DevTools → IndexedDB → `posync_v2` → `local_meta`, verify key `[store_id, device_id]` has:
   - `last_cursor` (non-empty)
   - `last_sync_time`
3. Update a Product on the server (or create one) and tap **Sync Now** again.
   - Expected:
     - the changed product arrives via `pullSyncEvents`
     - `cached_products` is updated

### Receipt reconciliation

1. Complete a sale offline (creates `local_receipts` row with `local_status=queued`).
2. Go online and wait for auto-sync OR tap **Sync Now**.
   - Expected:
     - the `completeSale` event becomes `applied` (or `duplicate_ignored`)
     - the `local_receipts` row transitions to `local_status=synced`
     - `server_receipt_number` is filled

## Store Scoping

1. Switch store (if you have multiple stores)
2. Ensure:
   - Items list shows only that store’s products
   - Counter only looks up that store’s cached_products
   - Sync payload includes correct store_id

## Parked Sale Safety

1. Add items → **Park**
2. Expected:
   - Offline event queued with `event_type=parkSale`
   - **Stock does NOT change** (no StockLedger entries for park)

## Stock Adjustment

1. Counter/Items → Adjust Stock
2. Expected:
   - Requires reason (restock/damaged/expired/lost/cycle_count/manual_correction/return_from_customer/return_to_supplier)
   - Creates StockLedger and updates Product.stock_quantity

---

## Auth (Custom DB-backed, NO Base44 auth)

### UI: Auth & Onboarding (Step 7)

1. **Sign Up mismatched passwords**
   - Go to `/signup`
   - Enter Password != Confirm Password
   - Expected:
     - Submit button disabled OR inline error shown
     - Cannot proceed
   - (Server hard gate is also validated in curl tests below.)

2. **Sign Up (no invitation code) → Welcome → OK → FirstStoreSetup → App**
   - `/signup` → fill Full Name / Phone / Email / Password / Confirm
   - Expected: navigates to `/welcome` showing **all entered details**
   - Tap **OK**
   - Expected: navigates to `/first-store`
   - Enter Store Name → Create
   - Expected:
     - `createFirstStore` called
     - Active store set
     - Navigates to `/Counter`

3. **Sign Up with staff_invite code**
   - `/signup` → enter valid staff_invite code
   - Expected: `/welcome` shows invitation code
   - Tap **OK**
   - Expected:
     - Skips `/first-store`
     - Goes to Store Switcher (if multiple) or `/Counter`

4. **Sign In**
   - `/signin` → valid credentials
   - Expected:
     - If multiple stores: goes to `/StoreSwitcher`
     - Else: goes to `/Counter`

5. **PWA reload session restore**
   - While signed in, refresh the page
   - Expected:
     - Session restores from `localStorage.posync_session_v1`
     - App calls `authMe` on boot
     - No forced re-login

> These are **server endpoint** checks. Replace `BASE_URL` with your deployed Base44 functions URL.

### Sign up (password mismatch hard gate)

```bash
curl -sS "$BASE_URL/authSignUp" \
  -H 'Content-Type: application/json' \
  -d '{
    "full_name":"Juan Dela Cruz",
    "phone_number":"09xxxxxxxxx",
    "email":"juan@email.com",
    "password":"secret1",
    "confirm_password":"secret2",
    "invitation_code":"",
    "device_id":"DEVICE_UUID"
  }' | jq
```

Expected:
- `ok=false`
- `error.code=BAD_REQUEST`
- message mentions passwords do not match

### Sign up (success)

```bash
curl -sS "$BASE_URL/authSignUp" \
  -H 'Content-Type: application/json' \
  -d '{
    "full_name":"Juan Dela Cruz",
    "phone_number":"09xxxxxxxxx",
    "email":"juan@email.com",
    "password":"secret",
    "confirm_password":"secret",
    "invitation_code":"",
    "device_id":"DEVICE_UUID"
  }' | jq
```

Expected:
- `ok=true`
- `data.session.access_token` present
- `data.next_action=create_first_store`

### Create first store

```bash
ACCESS_TOKEN=... # from SignUp
curl -sS "$BASE_URL/createFirstStore" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"store_name":"My Sari-Sari Store","device_id":"DEVICE_UUID"}' | jq
```

Expected:
- `ok=true`
- returns `store` and `membership` with role `owner`

### Sign in (success)

```bash
curl -sS "$BASE_URL/authSignIn" \
  -H 'Content-Type: application/json' \
  -d '{"email":"juan@email.com","password":"secret","device_id":"DEVICE_UUID"}' | jq
```

Expected:
- `ok=true`
- `data.session.access_token` present

### authMe (session restore)

```bash
ACCESS_TOKEN=...
curl -sS "$BASE_URL/authMe" -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

Expected:
- `ok=true`
- user + memberships + stores returned

### Sign out

```bash
curl -sS "$BASE_URL/authSignOut" -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

Expected:
- `ok=true`
- subsequent `authMe` returns 401

## Sync (Server Contract — Step 3)

> These ensure **pushSyncEvents** and **pullSyncEvents** match the required shapes and cursor behavior.

### pushSyncEvents (single completeSale event)

```bash
ACCESS_TOKEN=...
STORE_ID=...
DEVICE_ID=...
EVENT_ID=$(uuidgen | tr -d "-") # any unique id is fine
CLIENT_TX_ID="$DEVICE_ID-$(date +%s%3N)-0001"

curl -sS "$BASE_URL/pushSyncEvents" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    "store_id":"$STORE_ID",
    "device_id":"$DEVICE_ID",
    "events":[{
      "event_id":"$EVENT_ID",
      "store_id":"$STORE_ID",
      "device_id":"$DEVICE_ID",
      "client_tx_id":"$CLIENT_TX_ID",
      "event_type":"completeSale",
      "payload":{
        "store_id":"$STORE_ID",
        "client_tx_id":"$CLIENT_TX_ID",
        "device_id":"$DEVICE_ID",
        "sale":{
          "sale_type":"counter",
          "status":"completed",
          "items":[{"product_id":"P1","qty":1,"unit_price_centavos":1500,"line_discount_centavos":0}],
          "discount_centavos":0,
          "payments":[{"method":"cash","amount_centavos":1500}],
          "customer_id":null,
          "notes":""
        }
      },
      "created_at_device":$(date +%s%3N)
    }]
  }" | jq
```

Expected:
- `ok=true`
- `data.results[0].event_id` matches
- `data.results[0].status` is `applied` (or `duplicate_ignored` on replay)
- if applied: `data.results[0].data.server_sale_id` and `data.results[0].data.server_receipt_number` exist

### pullSyncEvents (cursor-based)

```bash
ACCESS_TOKEN=...
STORE_ID=...
DEVICE_ID=...
CURSOR=null

curl -sS "$BASE_URL/pullSyncEvents" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{"store_id":"$STORE_ID","device_id":"$DEVICE_ID","cursor":$CURSOR}" | jq
```

Expected:
- `ok=true`
- `data.new_cursor` is a non-empty string
- `data.updates.products/customers/categories` arrays present
- `data.updates.tombstones.products` present (may be empty)

Cursor safety check:
1) Run pull once, capture `new_cursor`
2) Modify a Product in the store (or create one)
3) Run pull again with `cursor=<previous new_cursor>`
- Expected: changed product appears in `updates.products`


---

## Step 12 — Multi-store + Reports + Referral + Final Suite

### Multi-store

1. Log in with a user that has **2+ stores** (two StaffMember memberships).
2. Expected:
   - On first load (no store selected yet), a **Store Picker** bottom sheet appears.
   - Picking a store sets active store (persisted) and the app scopes to it.
3. Tap store name in the top bar → store picker opens again.
4. Confirm:
   - Counter / Items / CustomersDue / SyncStatus use the selected store.

### Owner Combined View

1. If you are **Owner** and have multiple stores:
2. Go to **Today** tab → toggle **All Stores**.
   - Expected: Sales totals reflect combined stores.
3. Go to **Reports** tab → toggle **All Stores**.
   - Expected: Per-store breakdown card appears.

### Reports (required sections)

1. Reports tab should show:
   - Sales Summary (today/week/month)
   - Top Products (qty + revenue)
   - Gross Profit (uses cost snapshot)
   - Inventory Health (low/out-of-stock counts)
   - Due Aging buckets (0–7, 8–30, 31+)
   - Cashier Performance (permission gated)
2. Permission checks:
   - If `reports_access` is OFF for the role → Reports shows an access denied message.
   - If `financial_visibility` is OFF → money values show **Hidden**.
   - If `reports_drilldowns` is ON → tapping drilldown buttons opens a sheet.

### Referral apply-once enforcement

1. More → Affiliate/Referral
2. Apply a partner referral code.
   - Expected: success message, StoreSettings updated, code shows as applied.
3. Attempt to apply another code.
   - Expected: server rejects (apply-once).

### Final global suite (must pass)

Fast checkout:
1) Counter → Scan Mode → scan 5 different barcodes quickly → cart increments without closing scanner
2) Scan same barcode 3x → qty becomes +3
3) Hardware wedge: focus search → scan → Enter triggers auto-add
4) Not found → Add New Item (barcode prefilled) → save → scan again adds

Offline:
1) airplane mode → scan cached item → adds
2) complete sale offline → local_receipts queued
3) online → sync → receipt number reconciled; no duplicates

Store scoping:
- Switching stores changes Items list and Counter lookup (no cross-store bleed)

---

## Inventory Management (Counts + Tags + Restock Tools)

## Step 9 — Inventory Health + Stock Ops (Retail-safe)

### Inventory Health Check card (Counter tab)

1. Go to **Counter** tab.
2. Find **Inventory Health** card.
   - Expected counts:
     - **Sellable** = active items where `product_type !== parent`
     - **Tracked** = sellable items with `track_stock = true`
     - **Low** = tracked items with `0 < stock_quantity <= (product.low_stock_threshold ?? store.low_stock_threshold_default)`
     - **Out** = tracked items with `stock_quantity === 0`
     - **Negative** (only if `allow_negative_stock` is ON) = tracked items with `stock_quantity < 0`
3. Tap **Low** → should open Items with Low filter.
4. Tap **Out** → should open Items with Out of Stock filter.

### Adjust Stock (requires reason, queues offline event)

1. Counter → Inventory Health → **Adjust Stock**.
2. Pick an item by:
   - scanning barcode (camera), OR
   - wedge scanner (Enter), OR
   - typing name and tapping a suggestion.
3. Choose **Add** or **Remove**, enter quantity.
4. Choose a **Reason** (must be one of):
   - restock, damaged, expired, lost, cycle_count, manual_correction, return_from_customer, return_to_supplier
5. Click **Queue Adjustment**.
   - Expected (offline-first):
     - Dexie `offline_queue` row created with `event_type=adjustStock`
     - Cached product stock updates immediately (optimistic) in Items/Counter
6. If online → Sync should push automatically.
   - Expected:
     - Server applies and StockLedger has an "adjustment" entry
     - Next pull updates cached_products to server truth
7. If user role lacks permission and store requires PIN:
   - Expected: Owner PIN modal appears.
   - Enter correct PIN → adjustment queues with `owner_pin_proof` included.

### Inventory Counts + Tagging

1. Go to **Items** tab.
2. Confirm **Inventory Counts** card shows:
   - Total items
   - Critical count (includes Out of Stock + Critical)
   - Low count
   - Out count
3. Tap **Critical / Low / Out** boxes.
   - Expected: list filters accordingly.
4. Confirm item cards show:
   - Picture (or placeholder)
   - Total stock
   - Monthly sold
   - Tag badge: Safe / Low / Critical / Out of Stock
   - **+ button** (Add Stocks)

### Sorting + Search

1. Use search input to filter by name/barcode.
2. Use dropdown:
   - Slow Moving / Fast Moving
   - Stock (Low→High) / Stock (High→Low)
   - Name A–Z / Z–A
3. Expected: list order updates immediately.

### Restock (+ button) with History

1. Tap **+** on any item.
2. Expected Restock drawer:
   - Current stock + current cost
   - Inputs: Restock qty (+) and New cost (optional)
   - History list of restocks with date, qty delta, prev/new qty, prev/new cost
3. Enter restock qty and optionally new cost, then **Queue Restock**.
4. Expected:
   - Dexie `offline_queue` row created with `event_type=restockProduct`
   - Item stock/cost updates immediately (optimistic cached_products patch)
   - When online, sync applies and StockLedger shows restock entry

### Restock using CSV File

1. Items → Card “Restock using CSV File” → **Download Sheet**
2. Open the CSV and set `restock_qty` for 1–2 items and/or `new_cost_centavos`.
3. Back in app → **Update New Stocks** → upload the CSV.
4. Preview sheet opens.
5. Click **Import Selected**.
6. Expected:
   - Queues one `restockProduct` event per actionable row
   - Cached products update immediately
   - When online, sync applies and StockLedger shows restock history

### Restock Checklists

1. Items → “Restock Checklists” → **Start Restocking**
2. Picker opens with:
   - Critical Items Only (with count)
   - Low & Critical Items (with count)
   - All Stocked Items (with count)
3. Choose a criteria → list page appears.
4. For 2+ items:
   - tick select box
   - set restock qty (+)
   - click New cost and set new cost
   - optionally remove one row using trash icon
5. Click **Import (Selected Only)**.
6. Expected:
   - Queues restockProduct events only for selected actionable rows
   - Returns to Items tab
   - Items list reflects updated stock/cost (optimistic)

---

## Step 10 — UTANG (DUE) + PAYMENTS (split/partial + offline queue)

### A) Due sale reduces stock + updates customer balance

1. Go to **Counter**.
2. Add 1–2 items to cart.
3. Tap **Complete** → Payment drawer.
4. Switch to **Utang**.
5. Select a customer.
6. (Optional) Enter a partial payment (e.g., Cash ₱10.00).
7. Confirm.

Expected:
- Sale is queued as `completeSale` with `sale.status="due"` and `customer_id`.
- Stock decreases when synced (or immediately if online).
- Customer `balance_due_centavos` increases by the remaining due amount.

### B) Split payments + change

1. Counter → add items totaling e.g. **₱60**.
2. Payment drawer (Paid):
   - Payment line 1: Cash ₱100
   - Add line 2: GCash ₱0 (or remove)
3. Confirm.

Expected:
- If paid amount > total, Change is shown.
- `completeSale` payload contains `payments[]` (split supported).

### C) Due Customers screen (sorted + ledger)

1. Go to **More → Customers (Utang)**.
2. Expected:
   - Customers sorted by **highest due**, with an age badge (days).
   - Filter chips: All / 8–30 / 31+
3. Tap a customer.
4. Expected:
   - Shows outstanding balance
   - Ledger loads when online
   - When offline: shows queued payments note

### D) Record Payment (offline queue supported)

1. From a customer detail page, tap **Record Payment**.
2. Enter amount and method, then submit.
3. If offline:
   - Expected: a `recordPayment` event is created in Dexie `offline_queue`
   - Customer balance updates locally (optimistic)
4. When back online:
   - Sync runs automatically or via **Sync Now**
   - Payment is applied server-side and customer balance reconciles

---

## Step 11 — Roles/Permissions + Owner PIN gates + ActivityEvent audit log

### A) Permission enforcement (server + UI)

1. Sign in as **Cashier** (or set your membership role to cashier using Owner account).
2. Attempt the following actions:
   - Open **Reports** tab
   - Open **Permissions** page
   - Open **Devices** page
3. Expected:
   - UI blocks access for disallowed pages/actions.
   - If you force-call endpoints (e.g. via Sync push), server responds **403 FORBIDDEN**.

### B) Role template editing (Owner)

1. Sign in as **Owner**.
2. Go to **More → Permissions**.
3. Toggle a permission for **Manager** (e.g. enable `transaction_void`).
4. Tap **Save Changes**.
5. Expected:
   - `updateStorePermissions` succeeds.
   - After sync/pull, other devices see the updated role template.

### C) Per-user override

1. Owner → **More → Staff & Roles**.
2. Tap **Overrides** for a non-owner member.
3. Toggle `transaction_void` ON.
4. Save.
5. Expected:
   - `updateStoreMember` updates `overrides_json`.
   - That member can now see/use the enabled action (subject to PIN gates).

### D) Owner PIN gates

1. Owner → **More → Store Settings**.
2. Ensure PIN is set (Change Owner PIN).
3. Enable:
   - PIN: Void/Refund
   - PIN: Stock Adjustment
   - PIN: Device Revoke
4. As a non-owner user without those permissions:
   - Try **Void/Refund** from Sales Log.
   - Try **Adjust Stock** from Counter.
   - Try **Revoke device** from Devices.
5. Expected:
   - Owner PIN modal appears.
   - Without correct PIN: action fails.
   - With correct PIN: action queues/applies successfully.

### E) ActivityEvent audit log entries

Perform these actions (online or after syncing offline queue):
1. Complete a sale (completed or due)
2. Void a sale
3. Refund a sale
4. Adjust stock / Restock
5. Update permissions template (Permissions page)
6. Update a member override (Staff page)

Expected:
- ActivityEvent records exist with:
  - `store_id`
  - `event_type` matching the action
  - `reference_id`/entity id
  - metadata including `user_id` and `device_id` where available



---

## Step 11 — Roles/Permissions + Owner PIN gates + ActivityEvent audit

1. **Permission enforcement**
   - Sign in as Cashier.
   - Try: More → Permissions.
   - Expected: server returns 403 / UI shows permission error.

2. **Owner PIN gate (void/refund/adjust stock)**
   - Enable PIN requirement in Store Settings.
   - Try: Adjust Stock.
   - Expected: PIN prompt appears; without correct PIN proof, server rejects.

3. **ActivityEvent audit log written**
   - Complete a sale, adjust stock, record payment.
   - Expected: ActivityEvent rows exist for those actions (server-side logging + sync logging).

---

## Step 12 — Multi-store + Affiliate/Referral + Reports Drilldowns + Performance

### Multi-store

1. **Store switcher after login**
   - Account has 2+ stores.
   - Sign in.
   - Expected: routed to StoreSwitcher before main tabs.

2. **Owner Combined View**
   - As Owner with 2+ stores: open StoreSwitcher → Owner Combined View.
   - Expected:
     - Shows combined totals for selected period (Today/Week/Month)
     - Shows per-store breakdown
     - Shows live feed from ActivityEvent (read-only)

3. **Staff cannot see unassigned stores**
   - Sign in as Staff for Store A only.
   - Expected: StoreSwitcher lists only Store A; Combined View access denied.

### Affiliate / Referral

1. **Affiliate dashboard works without store**
   - Sign in with an account that has no store memberships.
   - Expected: routed to `/no-store`.
   - Tap “Go to Affiliate”.
   - Expected: affiliate dashboard loads, referral code visible.

2. **Apply referral code once (store settings)**
   - In Affiliate page with a valid store selected:
     - Enter a referral code → Apply.
   - Expected:
     - Success
     - Applying again fails with “already applied”

3. **Referral discount affects checkout total**
   - After referral applied (10%): go Counter.
   - Add items totaling ₱100.00.
   - Expected:
     - Cart shows Discount ₱10.00
     - Total becomes ₱90.00
     - Payment uses ₱90.00 as required amount

4. **Affiliate payout request requires GCash**
   - Affiliate → Request payout without saving GCash details.
   - Expected: server rejects with GCASH_REQUIRED.
   - Save GCash details → Request payout.
   - Expected: payout request created and appears in “Recent payout requests”.

### Reports drilldowns

1. **Reports overview**
   - Reports tab shows: Sales Summary, Top Products, Gross Profit, Inventory Health, Due Aging, Cashier Performance.

2. **Drilldowns are permission gated**
   - As Cashier without `reports_drilldowns`:
     - Tap “View sales drilldown”
     - Expected: disabled or shows permission reason.

3. **Sales drilldown**
   - As Owner/Manager with drilldown permission:
     - Reports → View sales drilldown
     - Expected: list of recent sales in range with receipt/client_tx_id.

4. **Inventory drilldown**
   - Reports → View Low Stocks / View Out of Stock
   - Expected: list displays item name + qty + threshold, store tag in combined view.

