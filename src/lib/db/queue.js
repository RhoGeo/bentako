import { db, Dexie } from "./dexie";

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
        detail: {
          store_id: row.store_id,
          event_id: row.event_id,
          event_type: row.event_type,
        },
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
    .filter(
      (e) => e.status === "queued" || e.status === "failed_retry" || e.status === "pushing"
    )
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
  const counts = {
    queued: 0,
    pushing: 0,
    failed_retry: 0,
    failed_permanent: 0,
    applied: 0,
    duplicate_ignored: 0,
    total: rows.length,
  };
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

/**
 * Step 10: show queued payments in the Due Customers ledger.
 *
 * Returns local queued/payment events for a customer (recordPayment).
 */
export async function listQueuedCustomerPayments(store_id, customer_id) {
  if (!store_id || !customer_id) return [];
  const rows = await db.offline_queue
    .where("[store_id+created_at_device]")
    .between([store_id, Dexie.minKey], [store_id, Dexie.maxKey])
    .filter((e) => String(e.event_type) === "recordPayment")
    .toArray();

  const out = [];
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload_json || "{}");
      if (String(payload.customer_id || "") !== String(customer_id)) continue;
      out.push({
        event_id: r.event_id,
        created_at_device: r.created_at_device,
        status: r.status,
        amount_centavos: Number(payload?.payment?.amount_centavos || 0),
        method: payload?.payment?.method || "cash",
        note: payload?.payment?.note || "",
      });
    } catch (_e) {
      // ignore
    }
  }

  out.sort((a, b) => (b.created_at_device || 0) - (a.created_at_device || 0));
  return out;
}
