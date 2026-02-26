/**
 * pushSyncEvents (Step 3)
 * Batch ingestion of offline events with per-event results + statuses.
 *
 * NOTE: This project uses the POSync SQL schema + transactional RPCs:
 * - public.posync_apply_sale
 * - public.posync_record_payment
 * - public.posync_adjust_stock
 * - public.posync_restock_product
 * - public.posync_void_sale
 * - public.posync_refund_sale
 *
 * These RPCs apply business logic atomically in the DB and are idempotent by the
 * keys in the payload (client_tx_id, payment_request_id, adjustment_id, restock_id, etc.).
 */

import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin, requirePermission } from "./_lib/guard.ts";
import { classifyFailure, toApiError } from "./_lib/errorPolicy.ts";
import { assertPushBody, assertEventEnvelope } from "./_lib/syncContract.ts";
import { logActivityEvent } from "./_lib/activity.ts";
import { rpc } from "./_lib/supabaseAdmin.ts";

async function getExistingSyncEvent(base44: any, store_id: string, event_id: string) {
  // SyncEvent storage is optional (some deployments may not have it).
  try {
    const ent = base44?.asServiceRole?.entities?.SyncEvent;
    if (!ent?.filter) return null;
    const rows = await ent.filter({ store_id, event_id });
    return rows?.[0] || null;
  } catch (_e) {
    return null;
  }
}

async function saveSyncEvent(base44: any, store_id: string, event: any, status: string, result_json: any, last_error?: any) {
  // Best-effort only; sync MUST work even if SyncEvent entity is unavailable.
  try {
    const ent = base44?.asServiceRole?.entities?.SyncEvent;
    if (!ent?.filter || !ent?.create) return null;
    const existing = await getExistingSyncEvent(base44, store_id, event.event_id);
    const payload_json = JSON.stringify(event.payload || {});
    const patch = {
      store_id,
      event_id: event.event_id,
      device_id: event.device_id,
      client_tx_id: event.client_tx_id || event.payload?.client_tx_id || null,
      event_type: event.event_type,
      payload_json,
      status,
      attempt_count: Number(existing?.attempt_count || 0) + 1,
      last_error: last_error ? JSON.stringify(last_error) : null,
      result_json,
      created_at_device: event.created_at_device,
      updated_at: new Date().toISOString(),
    };
    if (existing?.id && ent?.update) {
      await ent.update(existing.id, patch);
      return existing.id;
    }
    const created = await ent.create({ ...patch, created_at: new Date().toISOString() });
    return created?.id || null;
  } catch (_e) {
    return null;
  }
}

function asUuid(v: any): string {
  return String(v || "").trim();
}

function mapRpcToStatusAndData(res: any, data: any) {
  const dup = !!res?.duplicate;
  return { status: dup ? "duplicate_ignored" : "applied", data };
}

async function applyCompleteOrParkSale(store_id: string, device_id: string, payload: any, user: any) {
  const client_tx_id = String(payload?.client_tx_id || "").trim();
  const sale = payload?.sale;
  if (!client_tx_id || !sale) throw Object.assign(new Error("client_tx_id and sale required"), { code: "BAD_REQUEST" });

  const res = await rpc<any>("posync_apply_sale", {
    p_store_id: asUuid(store_id),
    p_user_id: asUuid(user.user_id),
    p_device_id: asUuid(device_id),
    p_client_tx_id: client_tx_id,
    p_sale: sale,
  });

  const data = {
    ...res,
    server_sale_id: res?.sale_id || null,
    server_receipt_number: res?.receipt_number || null,
  };
  return mapRpcToStatusAndData(res, data);
}

async function applyRecordPayment(store_id: string, device_id: string, payload: any, user: any) {
  const customer_id = asUuid(payload?.customer_id);
  const payment_request_id = String(payload?.payment_request_id || "").trim();
  const p = payload?.payment || {};
  const method = String(p?.method || "").trim();
  const amount_centavos = Number(p?.amount_centavos || 0);
  const note = String(p?.note || payload?.note || "");

  if (!customer_id || !payment_request_id || !method) {
    throw Object.assign(new Error("customer_id, payment_request_id, payment.method required"), { code: "BAD_REQUEST" });
  }

  const res = await rpc<any>("posync_record_payment", {
    p_store_id: asUuid(store_id),
    p_user_id: asUuid(user.user_id),
    p_device_id: asUuid(device_id),
    p_customer_id: customer_id,
    p_payment_request_id: payment_request_id,
    p_method: method,
    p_amount_centavos: amount_centavos,
    p_note: note,
  });

  return mapRpcToStatusAndData(res, res);
}

async function applyAdjustStock(store_id: string, payload: any, user: any) {
  const product_id = asUuid(payload?.product_id);
  const adjustment_id = String(payload?.adjustment_id || "").trim();
  const delta_qty = Number(payload?.delta_qty || 0);
  const reason = String(payload?.reason || "").trim();
  const note = String(payload?.note || "");

  if (!product_id || !adjustment_id || !reason) {
    throw Object.assign(new Error("product_id, adjustment_id, reason required"), { code: "BAD_REQUEST" });
  }

  const res = await rpc<any>("posync_adjust_stock", {
    p_store_id: asUuid(store_id),
    p_user_id: asUuid(user.user_id),
    p_product_id: product_id,
    p_adjustment_id: adjustment_id,
    p_delta_qty: delta_qty,
    p_reason: reason,
    p_note: note,
  });

  return mapRpcToStatusAndData(res, res);
}

async function applyRestockProduct(store_id: string, payload: any, user: any) {
  const product_id = asUuid(payload?.product_id);
  const restock_id = String(payload?.restock_id || "").trim();
  const restock_qty = Number(payload?.restock_qty || 0);
  const new_cost_centavos = payload?.new_cost_centavos === null || payload?.new_cost_centavos === undefined
    ? null
    : Number(payload?.new_cost_centavos || 0);
  const note = String(payload?.note || "");

  if (!product_id || !restock_id) {
    throw Object.assign(new Error("product_id and restock_id required"), { code: "BAD_REQUEST" });
  }

  const res = await rpc<any>("posync_restock_product", {
    p_store_id: asUuid(store_id),
    p_user_id: asUuid(user.user_id),
    p_product_id: product_id,
    p_restock_id: restock_id,
    p_restock_qty: restock_qty,
    p_new_cost_centavos: new_cost_centavos,
    p_note: note,
  });

  return mapRpcToStatusAndData(res, res);
}

async function applyVoidSale(store_id: string, device_id: string, payload: any, user: any) {
  const sale_id = asUuid(payload?.sale_id);
  const void_request_id = String(payload?.void_request_id || "").trim();
  const note = String(payload?.note || "");

  if (!sale_id || !void_request_id) {
    throw Object.assign(new Error("sale_id and void_request_id required"), { code: "BAD_REQUEST" });
  }

  const res = await rpc<any>("posync_void_sale", {
    p_store_id: asUuid(store_id),
    p_user_id: asUuid(user.user_id),
    p_device_id: asUuid(device_id),
    p_sale_id: sale_id,
    p_void_request_id: void_request_id,
    p_note: note,
  });

  return mapRpcToStatusAndData(res, res);
}

async function applyRefundSale(store_id: string, device_id: string, payload: any, user: any) {
  const sale_id = asUuid(payload?.sale_id);
  const refund_request_id = String(payload?.refund_request_id || "").trim();
  const refund = payload?.refund || {};

  if (!sale_id || !refund_request_id) {
    throw Object.assign(new Error("sale_id and refund_request_id required"), { code: "BAD_REQUEST" });
  }

  const res = await rpc<any>("posync_refund_sale", {
    p_store_id: asUuid(store_id),
    p_user_id: asUuid(user.user_id),
    p_device_id: asUuid(device_id),
    p_sale_id: sale_id,
    p_refund_request_id: refund_request_id,
    p_refund: refund,
  });

  return mapRpcToStatusAndData(res, res);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    assertPushBody(body);

    const store_id = body.store_id;
    const device_id = body.device_id;
    const events = body.events;

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);

    const results: any[] = [];

    for (const ev of events) {
      try {
        assertEventEnvelope(ev, { store_id, device_id });

        // Fast path: if we have a SyncEvent entity and this event_id was already applied, return the stored result.
        const existingSync = await getExistingSyncEvent(base44, store_id, ev.event_id);
        if (existingSync && (existingSync.status === "applied" || existingSync.status === "duplicate_ignored")) {
          results.push({ event_id: ev.event_id, status: "duplicate_ignored", data: existingSync.result_json || null });
          continue;
        }
        if (existingSync && existingSync.status === "failed_permanent") {
          results.push({
            event_id: ev.event_id,
            status: "failed_permanent",
            error: (() => {
              if (!existingSync.last_error) return { code: "UNKNOWN", message: "Previously failed" };
              try { return JSON.parse(existingSync.last_error); } catch (_e) { return { code: "UNKNOWN", message: String(existingSync.last_error) }; }
            })(),
          });
          continue;
        }

        // Apply
        const t = String(ev.event_type);
        let applied: any;

        if (t === "completeSale") {
          requirePermission(staff, "transaction_complete");
          applied = await applyCompleteOrParkSale(store_id, device_id, ev.payload, user);
        } else if (t === "parkSale") {
          requirePermission(staff, "transaction_complete");
          applied = await applyCompleteOrParkSale(store_id, device_id, ev.payload, user);
        } else if (t === "adjustStock") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "inventory_adjust_stock",
            pinSettingField: "pin_required_stock_adjust",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyAdjustStock(store_id, ev.payload, user);
        } else if (t === "recordPayment") {
          requirePermission(staff, "customers_record_payment");
          applied = await applyRecordPayment(store_id, device_id, ev.payload, user);
        } else if (t === "restockProduct") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "inventory_adjust_stock",
            pinSettingField: "pin_required_stock_adjust",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyRestockProduct(store_id, ev.payload, user);
        } else if (t === "voidSale") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "transaction_void",
            pinSettingField: "pin_required_void_refund",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyVoidSale(store_id, device_id, ev.payload, user);
        } else if (t === "refundSale") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "transaction_refund",
            pinSettingField: "pin_required_void_refund",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyRefundSale(store_id, device_id, ev.payload, user);
        } else {
          throw Object.assign(new Error(`Unknown event_type: ${t}`), { code: "BAD_REQUEST" });
        }

        await saveSyncEvent(base44, store_id, ev, applied.status, applied.data || null, null);
        results.push({ event_id: ev.event_id, status: applied.status, data: applied.data || null });
      } catch (err) {
        const status = classifyFailure(err);
        const apiErr = toApiError(err);
        await saveSyncEvent(base44, store_id, ev, status, null, apiErr);
        results.push({ event_id: ev?.event_id || "", status, error: apiErr });
      }
    }

    // Audit sync outcomes
    try {
      const counts = {
        applied: results.filter((r) => r.status === "applied").length,
        duplicate_ignored: results.filter((r) => r.status === "duplicate_ignored").length,
        failed_retry: results.filter((r) => r.status === "failed_retry").length,
        failed_permanent: results.filter((r) => r.status === "failed_permanent").length,
        total: results.length,
      };
      await logActivityEvent(base44, {
        store_id,
        event_type: counts.failed_permanent > 0 ? "sync_push_attention" : "sync_push_ok",
        description: "Sync push processed",
        user_id: user.user_id,
        actor_email: user.email,
        device_id,
        metadata_json: { counts },
      });
    } catch (_e) {}

    return jsonOk({ results, server_time: Date.now() });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
