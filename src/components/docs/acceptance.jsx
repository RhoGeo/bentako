# POSync Manual Acceptance Checklist
Generated: 2026-02-23

---

## Step 1 — Offline Foundation (Steps 1–4 contract)

### A. Dexie DB
- [ ] Open DevTools → Application → IndexedDB → "posync_v1"
- [ ] Confirm tables exist: `cached_products`, `cached_customers`, `offline_queue`, `local_receipts`, `local_meta`
- [ ] Open Counter page while online → DevTools IndexedDB → `cached_products` should have rows
- [ ] Open Counter page while **offline** (toggle DevTools Network → Offline) → products still visible

### B. Device ID
- [ ] DevTools → Application → Local Storage → key `posync_device_id` exists
- [ ] Reload page → same device_id (persisted)
- [ ] Open in different browser profile → different device_id

### C. client_tx_id format
- [ ] Complete a sale → check DevTools IndexedDB → `offline_queue` → `client_event_id` starts with `ev-`
- [ ] Check `local_receipts` → `client_tx_id` starts with `tx-`

---

## Step 2 — Offline Sale Queue

### Fast checkout (online)
1. Open Counter
2. Scan or tap 3 items
3. Tap "Complete Sale" → select payment → confirm
4. ✅ Toast: "Sale completed! ✓"
5. Check `offline_queue` in IndexedDB → entry with status = "applied" (after sync)

### Offline sale queue
1. DevTools Network → Offline
2. Open Counter → products loaded from Dexie cache
3. Add items → Complete Sale → confirm
4. ✅ Toast: "Queued — magsi-sync pag online."
5. Check `offline_queue` → status = "queued"
6. Check `local_receipts` → status = "queued"
7. DevTools Network → Online
8. Wait ~5s or go to Sync page → "Sync Now"
9. Check `offline_queue` → status = "applied"
10. Check `local_receipts` → status = "synced", receipt_number populated

### Park sale (stock must NOT decrease)
1. Add items to cart
2. Tap "Park"
3. Go to Items → verify stock unchanged
4. ✅ Toast: "Sale parked. Di pa nabawas ang stock."
5. Check `offline_queue` → event_type = "sale_parked"

---

## Step 3 — Barcode Scanner

### Camera scan (Counter)
1. Tap "Scan Mode" → camera opens
2. Point at a barcode → product auto-added to cart
3. ✅ Haptic vibration (on mobile) + toast "Added: {name} (+1)"
4. Scan unknown barcode → "Not found" panel appears
5. Tap "Add New Item" → navigate to ProductForm with barcode prefilled
6. Tap "Done" → returns to Counter with cart intact

### Manual entry fallback
1. Open Scanner → tap "Manual"
2. Type barcode → "Submit"
3. ✅ Same behavior as camera scan

### Wedge scanner (hardware)
1. Focus Counter search input
2. Plug in USB barcode scanner
3. Scan item → input populates → Enter fires → product added (if Auto-add ON)
4. Toggle "Auto-add on Enter" OFF → Enter populates search, does not add

### Items screen scan
1. Go to Items → tap scan icon in search bar
2. Scan existing product barcode → navigates to ProductForm for that item
3. Scan unknown → "Add New Item" → ProductForm with barcode prefilled

### ProductForm scan
1. New Product → tap scan icon next to Barcode field
2. Scan → barcode field populated, scanner closes
3. Variant row → tap scan → variant barcode field populated

---

## Step 4 — Idempotency

### Duplicate sale prevention
1. Complete a sale (get client_tx_id from IndexedDB)
2. Manually call pushSyncEvents with same client_event_id twice
3. ✅ Second response → status = "duplicate_ignored"
4. Database has only ONE sale record for that client_tx_id

### Void idempotency
1. Void a sale (voidSale function)
2. Call voidSale again with same sale_id
3. ✅ Response: `{ ok: true, idempotent: true }`
4. Stock restored exactly once

---

## Step 5 — Store Scoping

### Barcode uniqueness per store
1. Add product with barcode "123456" in store "default"
2. Try to add another product with same barcode in same store
3. ✅ Should warn or be blocked (enforce in ProductForm before save)

### Data isolation
1. All entities queried with `store_id = "default"`
2. Dexie caches keyed by `store_id`
3. DevTools IndexedDB → `cached_products` → all rows have `store_id = "default"`

---

## Step 6 — Sync Status UI

1. Go to More → Sync Status
2. While offline, complete a sale → Sync page shows "1 Queued"
3. Go online → tap "Sync Now" → status moves to "Done"
4. If permanent failure → red "IMMEDIATE ATTENTION" banner on Today page

---

## Wiring Map

```
Counter → WedgeScannerInput(Enter) → handleEnterSubmit → lookupBarcode(Dexie→memory→server) → addToCart
Counter → "Scan Mode" button → BarcodeScannerModal(ZXing continuous) → onFound → lookupBarcode → addToCart
Counter → "Complete Sale" → PaymentDrawer → handlePaymentConfirm → enqueueOfflineEvent(Dexie) + upsertLocalReceipt → (if online) Sale.create + syncNow
Counter → "Park" → handlePark → enqueueOfflineEvent(event_type="sale_parked") → NO stock deduction

Items → scan icon → BarcodeScannerModal(single) → onFound → navigate ProductForm?id=
Items → Enter in search → navigate ProductForm?id=

ProductForm → scan icon (main) → BarcodeScannerModal → onFound → fill form.barcode
ProductForm → scan icon (variant row) → BarcodeScannerModal → onFound → fill variants[i].barcode

syncNow → pushQueuedEvents(Dexie getQueuedEvents → invoke pushSyncEvents fn) → pullUpdates(invoke pullSyncEvents fn → upsertCachedProducts/Customers)
```

---

## File → Contract Mapping

| Contract Name | Actual Path |
|---|---|
| Dexie DB | `components/lib/db.js` |
| deviceId / clientTxId | `components/lib/deviceId.js` |
| SyncManager | `components/lib/syncManager.js` |
| pushSyncEvents | `functions/pushSyncEvents.js` |
| pullSyncEvents | `functions/pullSyncEvents.js` |
| barcodeLookup | `functions/barcodeLookup.js` |
| voidSale | `functions/voidSale.js` |
| adjustStock | `functions/adjustStock.js` |
| BarcodeScannerModal (ZXing) | `components/global/BarcodeScannerModal.jsx` |
| Counter (offline wired) | `pages/Counter.jsx` |
| Items (scan wired) | `pages/Items.jsx` |
| ProductForm (scan wired) | `pages/ProductForm.jsx` |