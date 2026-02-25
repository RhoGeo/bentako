/**
 * POSync SyncManager (Step 5)
 *
 * REAL push → pull → reconcile.
 *
 * Trigger rules:
 * - app start
 * - network regain (offline → online)
 * - after queueing any event (window event: posync:offline_event_enqueued)
 * - manual “Sync Now” button
 */

import { invokeFunction } from "@/api/posyncClient";
import {
  db,
  upsertCachedProducts,
  upsertCachedCustomers,
  upsertCachedCategories,
  deleteCachedProductsByIds,
  deleteCachedCustomersByIds,
  deleteCachedCategoriesByIds,
  updateQueueEventStatus,
  upsertLocalReceipt,
  getLocalMeta,
  setLocalMeta,
} from "@/lib/db";
import { getDeviceId } from "@/lib/ids/deviceId";
import { isOnline } from "./network";

const MAX_BATCH = 25;
const MAX_ATTEMPTS = 8;

// Prevent overlapping sync runs per-store.
const inFlightByStore = new Map();

function safeJsonParse(maybeJson) {
  if (!maybeJson) return {};
  if (typeof maybeJson === "object") return maybeJson;
  try {
    return JSON.parse(maybeJson);
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
    payload: safeJsonParse(local.payload_json),
    created_at_device: local.created_at_device,
  };
}

async function listEventsForPush(store_id, limit = MAX_BATCH) {
  // Reset any stuck "pushing" events from a prior crash/reload.
  const stuck = await db.offline_queue
    .where("[store_id+status]")
    .equals([store_id, "pushing"])
    .toArray();
  if (stuck.length > 0) {
    await Promise.all(
      stuck.map((e) =>
        updateQueueEventStatus(e.event_id, {
          status: "failed_retry",
          attempt_count: (e.attempt_count || 0) + 1,
          last_error: e.last_error || "Recovered from interrupted sync",
        })
      )
    );
  }

  const queued = await db.offline_queue
    .where("[store_id+status]")
    .equals([store_id, "queued"])
    .toArray();
  const retry = await db.offline_queue
    .where("[store_id+status]")
    .equals([store_id, "failed_retry"])
    .toArray();

  const all = [...queued, ...retry];
  all.sort((a, b) => (a.created_at_device || 0) - (b.created_at_device || 0));
  return all.slice(0, limit);
}

function isSaleEventType(event_type) {
  return event_type === "completeSale";
}

/**
 * PUSH: send queued events (queued + failed_retry) to server.
 *
 * @param {string} store_id
 */
export async function pushQueuedEvents(store_id) {
  if (!store_id) return { pushed: 0, results: [], reason: "missing_store" };
  if (!isOnline()) return { pushed: 0, results: [], reason: "offline" };

  const device_id = getDeviceId();
  const batch = await listEventsForPush(store_id, MAX_BATCH);
  if (batch.length === 0) return { pushed: 0, results: [] };

  // Mark as pushing BEFORE sending (spec requirement).
  await Promise.all(batch.map((e) => updateQueueEventStatus(e.event_id, { status: "pushing" })));

  let response;
  try {
    response = await invokeFunction("pushSyncEvents", {
      store_id,
      device_id,
      events: batch.map((e) => toEnvelopeForServer(e, store_id, device_id)),
    });
  } catch (err) {
    const msg = err?.message || "push failed";
    const isPermanent = /FORBIDDEN|UNAUTHORIZED|PIN_REQUIRED/i.test(msg);

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

  // Base44 SDK sometimes nests the payload.
  const results = response?.data?.results || response?.data?.data?.results || [];

  const byId = new Map(batch.map((e) => [e.event_id, e]));
  const seen = new Set();

  for (const r of results) {
    const local = byId.get(r.event_id);
    if (!local) continue;
    seen.add(r.event_id);
    const status = r.status;

    if (status === "applied" || status === "duplicate_ignored") {
      await updateQueueEventStatus(local.event_id, { status, last_error: null });

      // Receipt reconciliation for sale events
      if (local.client_tx_id && isSaleEventType(local.event_type)) {
        const server_sale_id = r?.data?.server_sale_id || null;
        const server_receipt_number = r?.data?.server_receipt_number || null;
        await upsertLocalReceipt({
          store_id,
          client_tx_id: local.client_tx_id,
          local_status: "synced",
          server_sale_id,
          server_receipt_number,
        });
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
      if (local.client_tx_id && isSaleEventType(local.event_type)) {
        await upsertLocalReceipt({
          store_id,
          client_tx_id: local.client_tx_id,
          local_status: "failed",
          last_error: r?.error?.message || r?.error || "failed_permanent",
        });
      }
    } else {
      // Unknown status: retry.
      const attempts = (local.attempt_count || 0) + 1;
      await updateQueueEventStatus(local.event_id, {
        status: attempts >= MAX_ATTEMPTS ? "failed_permanent" : "failed_retry",
        attempt_count: attempts,
        last_error: r?.error?.message || "Unknown server status",
      });
    }
  }

  const missing = batch.filter((e) => !seen.has(e.event_id));
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (e) => {
        const attempts = (e.attempt_count || 0) + 1;
        await updateQueueEventStatus(e.event_id, {
          status: attempts >= MAX_ATTEMPTS ? "failed_permanent" : "failed_retry",
          attempt_count: attempts,
          last_error: "No result from server for this event",
        });
      })
    );
  }

  return { pushed: batch.length, results };
}

/**
 * PULL: cursor-based pull from server then upsert Dexie caches.
 *
 * @param {string} store_id
 */
export async function pullUpdates(store_id) {
  if (!store_id) return { pulled: 0, reason: "missing_store" };
  if (!isOnline()) return { pulled: 0, reason: "offline" };

  const device_id = getDeviceId();
  const meta = await getLocalMeta(store_id, device_id);
  const cursor = meta?.last_cursor || null;

  let response;
  try {
    response = await invokeFunction("pullSyncEvents", { store_id, device_id, cursor });
  } catch (err) {
    const msg = err?.message || "pull failed";
    await setLocalMeta(store_id, device_id, {
      last_sync_error: msg,
      last_sync_time: Date.now(),
    });
    return { pulled: 0, error: msg };
  }

  const data = response?.data?.data || response?.data;
  const updates = data?.updates || {};
  const tombstones = updates?.tombstones || {};

  await Promise.all([
    upsertCachedProducts(updates.products || [], store_id),
    upsertCachedCustomers(updates.customers || [], store_id),
    upsertCachedCategories(updates.categories || [], store_id),
  ]);

  await Promise.all([
    Array.isArray(tombstones.products) && tombstones.products.length > 0
      ? deleteCachedProductsByIds(store_id, tombstones.products)
      : Promise.resolve(),
    Array.isArray(tombstones.customers) && tombstones.customers.length > 0
      ? deleteCachedCustomersByIds(store_id, tombstones.customers)
      : Promise.resolve(),
    Array.isArray(tombstones.categories) && tombstones.categories.length > 0
      ? deleteCachedCategoriesByIds(store_id, tombstones.categories)
      : Promise.resolve(),
  ]);

  if (data?.new_cursor) {
    await setLocalMeta(store_id, device_id, {
      last_cursor: data.new_cursor,
      last_sync_time: Date.now(),
      last_sync_error: null,
      store_settings_json: updates.store_settings ?? null,
    });
  }

  const pulled =
    (updates.products?.length || 0) +
    (updates.customers?.length || 0) +
    (updates.categories?.length || 0);

  return { pulled, new_cursor: data?.new_cursor || null };
}

/**
 * syncNow = push → pull → reconcile.
 *
 * @param {string} store_id
 */
export async function syncNow(store_id) {
  if (!store_id)
    return { ok: false, pushed: 0, pulled: 0, pushErrors: 0, reason: "missing_store" };
  if (!isOnline())
    return { ok: false, pushed: 0, pulled: 0, pushErrors: 0, reason: "offline" };

  if (inFlightByStore.has(store_id)) return inFlightByStore.get(store_id);

  const run = (async () => {
    const push = await pushQueuedEvents(store_id);
    const pull = await pullUpdates(store_id);
    const pushErrors =
      push?.results?.filter((r) => r.status !== "applied" && r.status !== "duplicate_ignored")
        ?.length || 0;

    return {
      ok: true,
      pushed: push.pushed || 0,
      pulled: pull.pulled || 0,
      pushErrors,
    };
  })();

  inFlightByStore.set(store_id, run);

  try {
    return await run;
  } finally {
    inFlightByStore.delete(store_id);
  }
}

/**
 * Auto-sync trigger rules (Step 5):
 * - app start
 * - network regain
 * - after queueing any event (posync:offline_event_enqueued)
 */
export function startAutoSync({ getStoreId, debounceMs = 1200 } = {}) {
  if (typeof window === "undefined") return () => {};
  const resolveStoreId = () => (typeof getStoreId === "function" ? getStoreId() : null);
  let timer = null;

  const schedule = (sidOverride) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const sid = sidOverride || resolveStoreId();
      if (sid) syncNow(sid).catch(() => {});
    }, debounceMs);
  };

  // app start
  schedule();

  const onOnline = () => schedule();
  const onEnqueued = (e) => schedule(e?.detail?.store_id);

  window.addEventListener("online", onOnline);
  window.addEventListener("posync:offline_event_enqueued", onEnqueued);

  return () => {
    clearTimeout(timer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("posync:offline_event_enqueued", onEnqueued);
  };
}
