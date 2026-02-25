/**
 * SyncManager (Step 5)
 * Push queued offline events → Pull cursor-based updates → Reconcile local_receipts.
 */

import { base44 } from "@/api/base44Client";
import {
  getQueuedEvents,
  updateQueueEventStatus,
  upsertCachedProducts,
  upsertCachedCustomers,
  upsertCachedCategories,
  deleteCachedProductsByIds,
  upsertLocalReceipt,
  getLocalMeta,
  setLocalMeta,
} from "@/components/lib/db";
import { getDeviceId } from "@/components/lib/deviceId";

const MAX_BATCH = 25;
const MAX_ATTEMPTS = 8;

function parsePayloadJson(payload_json) {
  if (!payload_json) return {};
  if (typeof payload_json === "object") return payload_json;
  try {
    return JSON.parse(payload_json);
  } catch (_e) {
    return {};
  }
}

function toEnvelopeForServer(local, store_id, device_id) {
  return {
    event_id: local.event_id,
    store_id,
    device_id,
    client_tx_id: local.client_tx_id || null,
    event_type: local.event_type,
    payload: parsePayloadJson(local.payload_json),
    created_at_device: local.created_at_device,
  };
}

export async function pushQueuedEvents(store_id) {
  if (!navigator.onLine) return { pushed: 0, results: [], reason: "offline" };
  const device_id = getDeviceId();
  const queued = await getQueuedEvents(store_id);
  const batch = queued.slice(0, MAX_BATCH);
  if (batch.length === 0) return { pushed: 0, results: [] };

  let response;
  try {
    response = await base44.functions.invoke("pushSyncEvents", {
      store_id,
      device_id,
      events: batch.map((e) => toEnvelopeForServer(e, store_id, device_id)),
    });
  } catch (err) {
    // network/server error → mark retry (do NOT mark as pushing first to avoid stuck state)
    const msg = err?.message || "push failed";
    // Permanent if client/auth error (4xx). We can't reliably inspect status, so fall back to message parsing.
    const isPermanent = /status code 4\d\d/i.test(msg) || /FORBIDDEN|UNAUTHORIZED|PIN_REQUIRED/i.test(msg);
    await Promise.all(
      batch.map(async (e) => {
        const attempts = (e.attempt_count || 0) + 1;
        await updateQueueEventStatus(e.event_id, {
          status: isPermanent || attempts >= MAX_ATTEMPTS ? "failed_permanent" : "failed_retry",
          attempt_count: attempts,
          last_error: msg,
        });
      })
    );
    return { pushed: 0, results: [], error: msg };
  }

  const results = response?.data?.results || response?.data?.data?.results || [];

  for (const r of results) {
    const local = batch.find((e) => e.event_id === r.event_id);
    if (!local) continue;
    const status = r.status;

    if (status === "applied" || status === "duplicate_ignored") {
      await updateQueueEventStatus(local.event_id, { status, last_error: null });

      // Receipt reconciliation for sale events
      if (local.client_tx_id && (local.event_type === "completeSale" || local.event_type === "parkSale")) {
        const server_sale_id = r?.data?.server_sale_id || null;
        const server_receipt_number = r?.data?.server_receipt_number || null;
        if (server_sale_id || server_receipt_number) {
          await upsertLocalReceipt({
            store_id,
            client_tx_id: local.client_tx_id,
            local_status: "synced",
            server_sale_id,
            server_receipt_number,
          });
        }
      }
    } else if (status === "failed_retry") {
      const attempts = (local.attempt_count || 0) + 1;
      await updateQueueEventStatus(local.event_id, {
        status: attempts >= MAX_ATTEMPTS ? "failed_permanent" : "failed_retry",
        attempt_count: attempts,
        last_error: r?.error?.message || r?.error || "failed_retry",
      });
    } else if (status === "failed_permanent") {
      await updateQueueEventStatus(local.event_id, {
        status: "failed_permanent",
        last_error: r?.error?.message || r?.error || "failed_permanent",
      });
      if (local.client_tx_id) {
        await upsertLocalReceipt({
          store_id,
          client_tx_id: local.client_tx_id,
          local_status: "failed",
          last_error: r?.error?.message || r?.error || "failed_permanent",
        });
      }
    }
  }

  return { pushed: batch.length, results };
}

export async function pullUpdates(store_id) {
  if (!navigator.onLine) return { pulled: 0, reason: "offline" };
  const device_id = getDeviceId();
  const meta = await getLocalMeta(store_id, device_id);
  const cursor = meta?.last_cursor || null;

  let response;
  try {
    response = await base44.functions.invoke("pullSyncEvents", { store_id, device_id, cursor });
  } catch (err) {
    return { pulled: 0, error: err?.message || "pull failed" };
  }

  const data = response?.data?.data || response?.data;
  const updates = data?.updates || {};
  const tombstones = updates?.tombstones || {};

  await Promise.all([
    upsertCachedProducts(updates.products || [], store_id),
    upsertCachedCustomers(updates.customers || [], store_id),
    upsertCachedCategories(updates.categories || [], store_id),
  ]);

  if (Array.isArray(tombstones.products) && tombstones.products.length > 0) {
    await deleteCachedProductsByIds(store_id, tombstones.products);
  }

  if (data?.new_cursor) {
    await setLocalMeta(store_id, device_id, {
      last_cursor: data.new_cursor,
      last_sync_time: Date.now(),
    });
  }

  const pulled =
    (updates.products?.length || 0) +
    (updates.customers?.length || 0) +
    (updates.categories?.length || 0);
  return { pulled };
}

export async function syncNow(store_id) {
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  const push = await pushQueuedEvents(store_id);
  const pull = await pullUpdates(store_id);
  const pushErrors =
    push?.results?.filter((r) => r.status !== "applied" && r.status !== "duplicate_ignored")?.length || 0;
  return {
    ok: true,
    pushed: push.pushed || 0,
    pulled: pull.pulled || 0,
    pushErrors,
  };
}

/**
 * Auto-sync trigger rules (Step 5):
 * - app start
 * - network regain
 * - after queueing any event (posync:offline_event_enqueued)
 */
export function startAutoSync({ getStoreId, debounceMs = 1200 } = {}) {
  const resolveStoreId = () => (typeof getStoreId === "function" ? getStoreId() : "default");
  let timer = null;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const storeId = resolveStoreId();
      if (storeId) syncNow(storeId);
    }, debounceMs);
  };

  // app start
  schedule();

  const onOnline = () => schedule();
  const onEnqueued = () => schedule();
  window.addEventListener("online", onOnline);
  window.addEventListener("posync:offline_event_enqueued", onEnqueued);

  return () => {
    clearTimeout(timer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("posync:offline_event_enqueued", onEnqueued);
  };
}