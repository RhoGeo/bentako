import { corsHeaders } from "../_shared/cors.ts";
import { jsonOk } from "../_shared/response.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess, requireStorePermission } from "../_shared/storeAccess.ts";

out = await supabase.rpc("posync_apply_sale", { ... p_sale: sale });
if (error) throw new Error(error.message);

type EventEnvelope = {
  event_id: string;
  store_id: string;
  device_id: string;
  client_tx_id?: string | null;
  event_type: string;
  payload: any;
  created_at_device?: number;
};

function assertString(v: unknown, field: string) {
  const s = String(v ?? "").trim();
  if (!s) throw new Error(`${field} required`);
  return s;
}

function classifyFailure(err: unknown): "failed_retry" | "failed_permanent" {
  const msg = err instanceof Error ? err.message : String(err);

  // If this came from PostgREST/Supabase, it may have a code field
  const code = (err as any)?.code;

  // SQL RPC raises errcode 22023 for "Parent products are not sellable"
  if (code === "22023") return "failed_permanent";

  if (
    msg === "AUTH_REQUIRED" ||
    msg === "AUTH_EXPIRED" ||
    msg === "FORBIDDEN" ||
    msg === "PIN_REQUIRED" ||
    /Forbidden/i.test(msg) ||
    /required/i.test(msg) ||
    /must be/i.test(msg) ||
    /NOT_FOUND/i.test(msg) ||
    /not found/i.test(msg) ||
    /Parent products are not sellable/i.test(msg) ||
    /PAYMENT_EXCEEDS_BALANCE/i.test(msg) ||
    /NEGATIVE_STOCK_NOT_ALLOWED/i.test(msg) ||
    /SALE_NOT_VOIDABLE/i.test(msg) ||
    /SALE_NOT_FOUND/i.test(msg) ||
    /REFUND_ONLY_COMPLETED/i.test(msg) ||
    /REFUND_AMOUNT_MISMATCH/i.test(msg)
  ) {
    return "failed_permanent";
  }
  return "failed_retry";
}

async function requireOwnerPinIfEnabled(supabase: any, store_id: string, settingKey: string, owner_pin_proof: string | null) {
  const { data: store, error } = await supabase
    .from("stores")
    .select("owner_pin_hash,store_settings_json")
    .eq("store_id", store_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!store) throw new Error("Store not found");

  const settings = (store.store_settings_json || {}) as Record<string, any>;
  // Match client SAFE_DEFAULTS: if the key is missing, default to true.
  const enabledRaw = settings?.[settingKey];
  const enabled = enabledRaw === undefined ? true : !!enabledRaw;
  const ownerHash = store.owner_pin_hash as string | null;

  if (!enabled) return;
  if (!ownerHash) return; // no PIN set yet

  if (!owner_pin_proof || String(owner_pin_proof) !== String(ownerHash)) {
    throw new Error("PIN_REQUIRED");
  }
}

async function applyCompleteSale(supabase: any, store_id: string, user_id: string, device_id: string, payload: any) {
  const client_tx_id = assertString(payload?.client_tx_id, "client_tx_id");
  const sale = payload?.sale;
  if (!sale) throw new Error("sale required");

  const { data, error } = await supabase.rpc("posync_apply_sale", {
    p_store_id: store_id,
    p_user_id: user_id,
    p_device_id: device_id,
    p_client_tx_id: client_tx_id,
    p_sale: sale,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function applyParkSale(supabase: any, store_id: string, user_id: string, device_id: string, payload: any) {
  const client_tx_id = assertString(payload?.client_tx_id, "client_tx_id");
  const sale = payload?.sale;
  if (!sale) throw new Error("sale required");
  const parkSale = { ...sale, status: "parked" };

  const { data, error } = await supabase.rpc("posync_apply_sale", {
    p_store_id: store_id,
    p_user_id: user_id,
    p_device_id: device_id,
    p_client_tx_id: client_tx_id,
    p_sale: parkSale,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function applyRecordPayment(supabase: any, store_id: string, user_id: string, device_id: string, payload: any) {
  const customer_id = assertString(payload?.customer_id, "customer_id");
  const payment_request_id = assertString(payload?.payment_request_id, "payment_request_id");
  const p = payload?.payment;
  if (!p?.method) throw new Error("payment.method required");

  const { data, error } = await supabase.rpc("posync_record_payment", {
    p_store_id: store_id,
    p_user_id: user_id,
    p_device_id: device_id,
    p_customer_id: customer_id,
    p_payment_request_id: payment_request_id,
    p_method: p.method,
    p_amount_centavos: Number(p.amount_centavos || 0),
    p_note: String(p.note || ""),
  });
  if (error) throw new Error(error.message);
  return data;
}

async function applyAdjustStock(supabase: any, store_id: string, user_id: string, payload: any) {
  const product_id = assertString(payload?.product_id, "product_id");
  const adjustment_id = assertString(payload?.adjustment_id, "adjustment_id");
  const reason = assertString(payload?.reason, "reason");
  const delta_qty = Number(payload?.delta_qty);
  if (!Number.isFinite(delta_qty) || delta_qty === 0) throw new Error("delta_qty must be non-zero");

  const { data, error } = await supabase.rpc("posync_adjust_stock", {
    p_store_id: store_id,
    p_user_id: user_id,
    p_product_id: product_id,
    p_adjustment_id: adjustment_id,
    p_delta_qty: Math.trunc(delta_qty),
    p_reason: reason,
    p_note: String(payload?.note || ""),
  });
  if (error) throw new Error(error.message);
  return data;
}

async function applyRestockProduct(supabase: any, store_id: string, user_id: string, payload: any) {
  const product_id = assertString(payload?.product_id, "product_id");
  const restock_id = assertString(payload?.restock_id, "restock_id");
  const restock_qty = Number(payload?.restock_qty ?? 0);
  if (!Number.isFinite(restock_qty) || restock_qty < 0) throw new Error("restock_qty must be >= 0");

  const new_cost_centavos =
    payload?.new_cost_centavos === null || payload?.new_cost_centavos === undefined
      ? null
      : Number(payload?.new_cost_centavos);

  const { data, error } = await supabase.rpc("posync_restock_product", {
    p_store_id: store_id,
    p_user_id: user_id,
    p_product_id: product_id,
    p_restock_id: restock_id,
    p_restock_qty: Math.trunc(restock_qty),
    p_new_cost_centavos: new_cost_centavos === null ? null : Math.trunc(new_cost_centavos),
    p_note: String(payload?.note || ""),
  });
  if (error) throw new Error(error.message);
  return data;
}

async function applyVoidSale(supabase: any, store_id: string, user_id: string, device_id: string, payload: any) {
  const sale_id = assertString(payload?.sale_id, "sale_id");
  const void_request_id = assertString(payload?.void_request_id, "void_request_id");
  const note = String(payload?.note || "");

  const { data, error } = await supabase.rpc("posync_void_sale", {
    p_store_id: store_id,
    p_user_id: user_id,
    p_device_id: device_id,
    p_sale_id: sale_id,
    p_void_request_id: void_request_id,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function applyRefundSale(supabase: any, store_id: string, user_id: string, device_id: string, payload: any) {
  const sale_id = assertString(payload?.sale_id, "sale_id");
  const refund_request_id = assertString(payload?.refund_request_id, "refund_request_id");
  const refund = payload?.refund || {};

  const { data, error } = await supabase.rpc("posync_refund_sale", {
    p_store_id: store_id,
    p_user_id: user_id,
    p_device_id: device_id,
    p_sale_id: sale_id,
    p_refund_request_id: refund_request_id,
    p_refund: refund,
  });
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user, session } = await requireAuth(req);

    const body = await req.json();
    const store_id = assertString(body?.store_id, "store_id");
    const device_id = assertString(body?.device_id, "device_id");
    const events = Array.isArray(body?.events) ? (body.events as EventEnvelope[]) : [];
    if (events.length === 0) {
      return jsonOk({ results: [], server_time: Date.now() });
    }

    // Basic membership gate
    await requireStoreAccess({ user_id: user.user_id, store_id });

    // Device mismatch guard: access token is bound to a device
    if (String(session.device_id) !== String(device_id)) {
      throw new Error("FORBIDDEN");
    }

    const results: any[] = [];

    for (const ev of events) {
      const event_id = String(ev?.event_id || "");
      try {
        // Envelope validation
        if (!event_id) throw new Error("event_id required");
        if (String(ev.store_id) !== String(store_id)) throw new Error("BAD_REQUEST");
        if (String(ev.device_id) !== String(device_id)) throw new Error("BAD_REQUEST");
        if (!ev.event_type) throw new Error("event_type required");

        const t = String(ev.event_type);
        let out: any = null;

        if (t === "completeSale") {
          out = await applyCompleteSale(supabase, store_id, user.user_id, device_id, ev.payload);
        } else if (t === "parkSale") {
          out = await applyParkSale(supabase, store_id, user.user_id, device_id, ev.payload);
        } else if (t === "recordPayment") {
          out = await applyRecordPayment(supabase, store_id, user.user_id, device_id, ev.payload);
        } else if (t === "voidSale") {
          await requireStorePermission({ user_id: user.user_id, store_id, permission: "transaction_void" });
          await requireOwnerPinIfEnabled(
            supabase,
            store_id,
            "pin_required_void_refund",
            ev?.payload?.owner_pin_proof ?? null
          );
          out = await applyVoidSale(supabase, store_id, user.user_id, device_id, ev.payload);
        } else if (t === "refundSale") {
          await requireStorePermission({ user_id: user.user_id, store_id, permission: "transaction_refund" });
          await requireOwnerPinIfEnabled(
            supabase,
            store_id,
            "pin_required_void_refund",
            ev?.payload?.owner_pin_proof ?? null
          );
          out = await applyRefundSale(supabase, store_id, user.user_id, device_id, ev.payload);
        } else if (t === "adjustStock") {
          await requireOwnerPinIfEnabled(
            supabase,
            store_id,
            "pin_required_stock_adjust",
            ev?.payload?.owner_pin_proof ?? null
          );
          out = await applyAdjustStock(supabase, store_id, user.user_id, ev.payload);
        } else if (t === "restockProduct") {
          await requireOwnerPinIfEnabled(
            supabase,
            store_id,
            "pin_required_stock_adjust",
            ev?.payload?.owner_pin_proof ?? null
          );
          out = await applyRestockProduct(supabase, store_id, user.user_id, ev.payload);
        } else {
          throw new Error(`Unknown event_type: ${t}`);
        }

        const isDup = !!out?.duplicate;

        // For sale events, the client expects server_sale_id / server_receipt_number
        if (t === "completeSale" || t === "parkSale") {
          const sale_id = out?.sale_id || null;
          const receipt_number = out?.receipt_number || null;
          results.push({
            event_id,
            status: isDup ? "duplicate_ignored" : "applied",
            data: {
              server_sale_id: sale_id,
              server_receipt_number: receipt_number,
            },
          });
        } else if (t === "voidSale" || t === "refundSale") {
          results.push({
            event_id,
            status: isDup ? "duplicate_ignored" : "applied",
            data: out,
          });
        } else {
          results.push({ event_id, status: isDup ? "duplicate_ignored" : "applied", data: out });
        }
      } catch (err) {
        const status = classifyFailure(err);
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          event_id: event_id || "",
          status,
          error: { code: status === "failed_permanent" ? "PERMANENT" : "RETRY", message: msg },
        });
      }
    }

    return jsonOk({ results, server_time: Date.now() });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
