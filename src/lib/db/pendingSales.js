/**
 * pendingSales — Offline-first sales queue (Dexie)
 *
 * This is the new sales flow:
 * - Checkout NEVER blocks on network.
 * - We always write a sale record locally first (pendingSales).
 * - Background sync uploads pending sales in bulk to /api/sales/bulk-sync.
 *
 * Row shape (minimum):
 *  - sale_uuid (PK)
 *  - cartItems (array)
 *  - totalAmount (number, centavos)
 *  - timestamp (ms)
 *  - status: 'pending' | 'syncing' | 'failed' | 'synced'
 *
 * We also store extra fields needed for syncing:
 *  - store_id, device_id, sale (rpc payload), attempt_count, last_error
 */

import { db } from "./dexie";

const DEFAULT_STATUS = "pending";

export async function savePendingSale({
  store_id,
  sale_uuid,
  cartItems,
  totalAmount,
  timestamp = Date.now(),
  status = DEFAULT_STATUS,
  device_id = null,
  sale = null,
}) {
  if (!store_id) throw new Error("store_id is required");
  if (!sale_uuid) throw new Error("sale_uuid is required");

  await db.pendingSales.put({
    sale_uuid,
    store_id,
    device_id,
    cartItems: Array.isArray(cartItems) ? cartItems : [],
    totalAmount: Number(totalAmount || 0),
    timestamp: Number(timestamp || Date.now()),
    status: status || DEFAULT_STATUS,
    sale: sale || null,
    attempt_count: 0,
    last_error: null,
    updated_at: Date.now(),
  });

  try {
    window.dispatchEvent(new CustomEvent("posync:pending_sale_enqueued", { detail: { store_id, sale_uuid } }));
  } catch (_e) {}
}

export async function listPendingSales(store_id) {
  if (!store_id) return [];
  return db.pendingSales
    .where("[store_id+status]")
    .equals([store_id, "pending"])
    .sortBy("timestamp");
}

export async function listSalesByStatus(store_id, status) {
  if (!store_id) return [];
  return db.pendingSales
    .where("[store_id+status]")
    .equals([store_id, status])
    .sortBy("timestamp");
}

export async function getPendingSalesCounts(store_id) {
  if (!store_id) return { pending: 0, syncing: 0, failed: 0, total: 0 };
  const [pending, syncing, failed, total] = await Promise.all([
    db.pendingSales.where("[store_id+status]").equals([store_id, "pending"]).count(),
    db.pendingSales.where("[store_id+status]").equals([store_id, "syncing"]).count(),
    db.pendingSales.where("[store_id+status]").equals([store_id, "failed"]).count(),
    db.pendingSales.where("store_id").equals(store_id).count(),
  ]);
  return { pending, syncing, failed, total };
}

export async function markSalesStatus(store_id, saleUuids, status, { errorMessage } = {}) {
  if (!store_id || !saleUuids?.length) return;
  const now = Date.now();
  await db.pendingSales
    .where("sale_uuid")
    .anyOf(saleUuids)
    .modify((row) => {
      if (row.store_id !== store_id) return;
      row.status = status;
      row.updated_at = now;
      if (status === "failed" && errorMessage) {
        row.last_error = String(errorMessage || "");
      }
      if (status === "pending" && errorMessage) {
        row.last_error = String(errorMessage || "");
      }
      if (status === "syncing") {
        row.attempt_count = Number(row.attempt_count || 0) + 1;
      }
    });
}

export async function deletePendingSales(saleUuids) {
  if (!saleUuids?.length) return;
  await db.pendingSales.bulkDelete(saleUuids);
}

export async function resetStaleSyncing(store_id, olderThanMs = 5 * 60 * 1000) {
  if (!store_id) return;
  const cutoff = Date.now() - olderThanMs;
  const stuck = await db.pendingSales
    .where("[store_id+status]")
    .equals([store_id, "syncing"])
    .and((s) => Number(s.updated_at || s.timestamp || 0) < cutoff)
    .toArray();

  if (stuck.length) {
    await markSalesStatus(store_id, stuck.map((s) => s.sale_uuid), "pending", { errorMessage: "Recovered from interrupted sync" });
  }
}
