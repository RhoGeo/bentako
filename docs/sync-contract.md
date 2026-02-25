# POSync Sync Contract (Step 3)

This repo implements a **push → pull → reconcile** sync protocol designed for **offline-first** POS.

## Event Envelope (client → server)

Every offline event MUST include:

- `event_id` (UUID)
- `store_id`
- `device_id`
- `client_tx_id` (required for sale-type events)
- `event_type`
- `payload`
- `created_at_device` (epoch ms)

Client may also include `attempt_count`, `status`, `last_error` for local UI/debug.

### Sale-type events

Sale-type events are those that must be idempotent via `client_tx_id`:

- `completeSale`
- `parkSale`

## pushSyncEvents

**Input**

```json
{
  "store_id": "S1",
  "device_id": "DEVICE123",
  "events": [
    {
      "event_id": "uuid",
      "store_id": "S1",
      "device_id": "DEVICE123",
      "client_tx_id": "DEVICE123-1700000000000-0001",
      "event_type": "completeSale",
      "payload": { "...": "..." },
      "created_at_device": 1700000000000
    }
  ]
}
```

**Output**

```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "event_id": "uuid",
        "status": "applied|duplicate_ignored|failed_retry|failed_permanent",
        "data": { "server_sale_id": "SALE1", "server_receipt_number": "S1-000123" },
        "error": { "code": "SOME_CODE", "message": "Human readable" }
      }
    ],
    "server_time": 1700000000123
  }
}
```

## Idempotency Rules (server-side)

The server must treat these as idempotent and **never double-apply**:

- `completeSale`: `(store_id, client_tx_id)`
- `voidSale`: `(store_id, sale_id, void_request_id)`
- `refundSale`: `(store_id, sale_id, refund_request_id)`
- `adjustStock`: `(store_id, adjustment_id)`

Implementation notes:

- Business idempotency is enforced via the `IdempotencyKey` entity.
- Stock updates are crash-safe and idempotent via `StockLedger.mutation_key`.

## pullSyncEvents (cursor-based)

**Input**

```json
{ "store_id": "S1", "device_id": "DEVICE123", "cursor": "opaque-or-null" }
```

**Output**

```json
{
  "ok": true,
  "data": {
    "new_cursor": "next_cursor",
    "updates": {
      "products": [{ "product_id": "P1", "updated_at": "...", "snapshot": {} }],
      "customers": [],
      "categories": [],
      "store_settings": {},
      "tombstones": { "products": ["P_deleted_1"], "customers": [], "categories": [] }
    }
  }
}
```

### Cursor safety

The server returns `new_cursor` as the **maximum updated_at observed** during the pull.
This prevents missing updates that occur between filtering and responding.

## Conflict Rules

- **StockLedger** is append-only; product stock is updated via ledger mutation keys.
- **Product edits** are last-write-wins using `updated_at`, but sensitive fields can be protected in later steps.
- **Completed sales are immutable** except through `voidSale` and `refundSale`.

