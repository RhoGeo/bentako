/**
 * POSync Offline DB (Dexie)
 *
 * Step 4 spec tables + indexes:
 * - cached_products:   [store_id+product_id], [store_id+barcode], [store_id+name], updated_at
 * - cached_customers:  [store_id+customer_id], [store_id+name], updated_at
 * - cached_categories: [store_id+category_id], updated_at
 * - offline_queue:     event_id, [store_id+status], [store_id+created_at_device], client_tx_id
 * - local_meta:        [store_id+device_id]
 * - local_receipts:    [store_id+client_tx_id]
 */

import Dexie from "dexie";
import { normalizeBarcode } from "@/components/lib/deviceId";

export const db = new Dexie("posync_v2");

db.version(1).stores({
  cached_products:
    "[store_id+product_id],[store_id+barcode],[store_id+name],updated_at",
  cached_customers:
    "[store_id+customer_id],[store_id+name],updated_at",
  cached_categories: "[store_id+category_id],updated_at",
  offline_queue:
    "event_id,[store_id+status],[store_id+created_at_device],client_tx_id",
  local_meta: "[store_id+device_id]",
  local_receipts: "[store_id+client_tx_id]",
});

// ───────────────────────────────────────────────────────────────────────────
// Cached catalog helpers

/**
 * Offline-first barcode lookup.
 * MUST use Dexie compound index: [store_id+barcode]
 */
export async function getCachedProductByBarcode(store_id, barcode) {
  const bc = normalizeBarcode(barcode);
  if (!store_id || !bc) return null;
  const row = await db.cached_products
    .where("[store_id+barcode]")
    .equals([store_id, bc])
    .first();
  return row?.snapshot_json || null;
}

function coerceUpdatedAt(v) {
  if (!v) return new Date().toISOString();
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return new Date().toISOString();
}

function toCachedProductRow(input, fallbackStoreId) {
  // pullSyncEvents shape: { product_id, updated_at, snapshot }
  const snapshot = input?.snapshot || input;
  const store_id = snapshot?.store_id || fallbackStoreId;
  const product_id = input?.product_id || snapshot?.id;
  const updated_at = coerceUpdatedAt(input?.updated_at || snapshot?.updated_at || snapshot?.updated_date);
  const barcode = normalizeBarcode(snapshot?.barcode || "");
  const name = (snapshot?.name || "").toString();
  return {
    store_id,
    product_id,
    barcode,
    name,
    snapshot_json: snapshot,
    updated_at,
  };
}

export async function upsertCachedProducts(products, store_id) {
  if (!Array.isArray(products) || products.length === 0) return;
  const rows = products
    .map((p) => toCachedProductRow(p, store_id))
    .filter((r) => r.store_id && r.product_id);
  if (rows.length === 0) return;
  await db.cached_products.bulkPut(rows);
}

function toCachedCustomerRow(input, fallbackStoreId) {
  const snapshot = input?.snapshot || input;
  const store_id = snapshot?.store_id || fallbackStoreId;
  const customer_id = input?.customer_id || snapshot?.id;
  const updated_at = coerceUpdatedAt(input?.updated_at || snapshot?.updated_at || snapshot?.updated_date);
  const name = (snapshot?.name || "").toString();
  return {
    store_id,
    customer_id,
    name,
    snapshot_json: snapshot,
    updated_at,
  };
}

export async function upsertCachedCustomers(customers, store_id) {
  if (!Array.isArray(customers) || customers.length === 0) return;
  const rows = customers
    .map((c) => toCachedCustomerRow(c, store_id))
    .filter((r) => r.store_id && r.customer_id);
  if (rows.length === 0) return;
  await db.cached_customers.bulkPut(rows);
}

function toCachedCategoryRow(input, fallbackStoreId) {
  const snapshot = input?.snapshot || input;
  const store_id = snapshot?.store_id || fallbackStoreId;
  const category_id = input?.category_id || snapshot?.id;
  const updated_at = coerceUpdatedAt(input?.updated_at || snapshot?.updated_at || snapshot?.updated_date);
  return {
    store_id,
    category_id,
    snapshot_json: snapshot,
    updated_at,
  };
}

export async function upsertCachedCategories(categories, store_id) {
  if (!Array.isArray(categories) || categories.length === 0) return;
  const rows = categories
    .map((c) => toCachedCategoryRow(c, store_id))
    .filter((r) => r.store_id && r.category_id);
  if (rows.length === 0) return;
  await db.cached_categories.bulkPut(rows);
}

export async function deleteCachedProductsByIds(store_id, productIds) {
  if (!store_id || !Array.isArray(productIds) || productIds.length === 0) return;
  const keys = productIds.map((id) => [store_id, id]);
  await db.cached_products.bulkDelete(keys);
}

/**
 * Patch a cached product snapshot by store_id + product_id.
 * Used for optimistic offline updates (e.g., restock queued while offline).
 */
export async function patchCachedProductSnapshot(store_id, product_id, nextSnapshot) {
  if (!store_id || !product_id || !nextSnapshot) return;
  const key = [store_id, product_id];
  const existing = await db.cached_products.get(key);
  const updated_at = new Date().toISOString();
  const barcode = normalizeBarcode(nextSnapshot?.barcode || existing?.barcode || "");
  const name = (nextSnapshot?.name || existing?.name || "").toString();
  await db.cached_products.put({
    store_id,
    product_id,
    barcode,
    name,
    snapshot_json: nextSnapshot,
    updated_at,
  });
}

export async function getAllCachedProducts(store_id) {
  if (!store_id) return [];
  const rows = await db.cached_products
    .where("[store_id+name]")
    .between([store_id, Dexie.minKey], [store_id, Dexie.maxKey])
    .toArray();
  return rows.map((r) => r.snapshot_json).filter(Boolean);
}

export async function getAllCachedCustomers(store_id) {
  if (!store_id) return [];
  const rows = await db.cached_customers
    .where("[store_id+name]")
    .between([store_id, Dexie.minKey], [store_id, Dexie.maxKey])
    .toArray();
  return rows.map((r) => r.snapshot_json).filter(Boolean);
}

// ───────────────────────────────────────────────────────────────────────────
// Offline queue helpers

/**
 * Enqueue offline event (spec envelope).
 * Fields stored as required by spec.
 */
export async function enqueueOfflineEvent(envelope) {
  if (!envelope?.event_id) throw new Error("event_id required");
  if (!envelope?.store_id) throw new Error("store_id required");
  if (!envelope?.device_id) throw new Error("device_id required");
  if (!envelope?.event_type) throw new Error("event_type required");

  const row = {
    store_id: envelope.store_id,
    event_id: envelope.event_id,
    event_type: envelope.event_type,
    payload_json: JSON.stringify(envelope.payload ?? {}),
    created_at_device: envelope.created_at_device ?? Date.now(),
    status: "queued",
    retry_count: envelope.retry_count ?? 0,
    attempt_count: envelope.attempt_count ?? 0,
    last_error: envelope.last_error ?? null,
    device_id: envelope.device_id,
    client_tx_id: envelope.client_tx_id ?? null,
  };

  await db.offline_queue.put(row);
  // Auto-sync trigger (Step 5)
  try {
    window.dispatchEvent(
      new CustomEvent("posync:offline_event_enqueued", {
        detail: { store_id: row.store_id, event_id: row.event_id, event_type: row.event_type },
      })
    );
  } catch (_e) {}
  return row;
}

export async function listOfflineQueue(store_id) {
  if (!store_id) return [];
  return db.offline_queue
    .where("[store_id+created_at_device]")
    .between([store_id, Dexie.minKey], [store_id, Dexie.maxKey])
    .toArray();
}

export async function getQueuedEvents(store_id) {
  if (!store_id) return [];
  const rows = await db.offline_queue
    .where("[store_id+created_at_device]")
    .between([store_id, Dexie.minKey], [store_id, Dexie.maxKey])
    .filter((e) => e.status === "queued" || e.status === "failed_retry")
    .toArray();
  rows.sort((a, b) => (a.created_at_device || 0) - (b.created_at_device || 0));
  return rows;
}

export async function updateQueueEventStatus(event_id, updates) {
  if (!event_id) return;
  await db.offline_queue.update(event_id, updates);
}

export async function getOfflineQueueCounts(store_id) {
  const rows = await listOfflineQueue(store_id);
  const counts = { queued: 0, pushing: 0, failed_retry: 0, failed_permanent: 0, applied: 0, duplicate_ignored: 0, total: rows.length };
  for (const r of rows) {
    if (counts[r.status] !== undefined) counts[r.status] += 1;
  }
  return {
    queued: counts.queued + counts.failed_retry,
    pushing: counts.pushing,
    failed_permanent: counts.failed_permanent,
    total: counts.total,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Local receipts (reconciliation)

export async function upsertLocalReceipt(receipt) {
  if (!receipt?.store_id || !receipt?.client_tx_id) {
    throw new Error("local_receipts requires store_id + client_tx_id");
  }
  const row = {
    store_id: receipt.store_id,
    client_tx_id: receipt.client_tx_id,
    local_status: receipt.local_status ?? receipt.status ?? "queued",
    server_sale_id: receipt.server_sale_id ?? null,
    server_receipt_number: receipt.server_receipt_number ?? receipt.receipt_number ?? null,
    last_error: receipt.last_error ?? null,
  };
  await db.local_receipts.put(row);
}

export async function getLocalReceipt(store_id, client_tx_id) {
  if (!store_id || !client_tx_id) return null;
  const key = [store_id, client_tx_id];
  return (await db.local_receipts.get(key)) || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Local meta (cursor + sync info)

export async function getLocalMeta(store_id, device_id) {
  if (!store_id || !device_id) return null;
  return (await db.local_meta.get([store_id, device_id])) || null;
}

export async function setLocalMeta(store_id, device_id, patch) {
  if (!store_id || !device_id) return;
  const existing = (await getLocalMeta(store_id, device_id)) || { store_id, device_id };
  await db.local_meta.put({ ...existing, ...patch, store_id, device_id });
}
