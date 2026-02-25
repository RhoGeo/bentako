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

## Staff Invites (Link-based)

1. Owner: More → Staff & Roles → Staff Invites → New Invite
2. Create invite for a specific email + role.
   - Expected: invite link is generated and copied.
3. Open invite link in an incognito window or another device.
4. Log in as the invited email.
5. AcceptInvite page → Accept.
   - Expected: StaffMember is created/activated for that store.

## Archive Store

1. Owner: More → Store Settings → Danger Zone → Archive Store
   - Expected: Store becomes hidden from store picker.
2. More → My Stores
   - Expected: Store shows “Archived” badge and “Unarchive Store” button (owner only).
3. Unarchive store.
   - Expected: Store appears in store picker again.

---

## Inventory Management (Counts + Tags + Restock Tools)

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

