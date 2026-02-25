import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

// Only store_settings_json keys are written here (except for store columns below).
const SETTINGS_KEYS = new Set([
  "address",
  "contact",
  "pin_required_void_refund",
  "pin_required_discount_override",
  "pin_required_price_override",
  "pin_required_price_discount_override",
  "pin_required_stock_adjust",
  "pin_required_export",
  "pin_required_device_revoke",
  "auto_sync_on_reconnect",
  "auto_sync_after_event",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();
    const store_id = str(body?.store_id);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const membership = await requireStoreAccess({ user_id: user.user_id, store_id });
    if (membership.role !== "owner") return jsonFail(403, "FORBIDDEN", "Owner only");

    // Load current store settings.
    const { data: store, error: serr } = await supabase
      .from("stores")
      .select("store_id,store_name,store_settings_json,allow_negative_stock,low_stock_threshold_default")
      .eq("store_id", store_id)
      .single();
    if (serr) throw new Error(serr.message);

    const nextStoreName = body?.store_name != null ? str(body.store_name) : null;
    const nextAllowNegative = body?.allow_negative_stock != null ? !!body.allow_negative_stock : null;
    const nextLowStock = body?.low_stock_threshold_default != null ? Number(body.low_stock_threshold_default) : null;

    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (!SETTINGS_KEYS.has(k)) continue;
      patch[k] = v;
    }

    const merged = { ...(store.store_settings_json || {}), ...patch };

    const update: Record<string, any> = { store_settings_json: merged };
    if (nextStoreName !== null && nextStoreName.length >= 2) update.store_name = nextStoreName;
    if (nextAllowNegative !== null) update.allow_negative_stock = nextAllowNegative;
    if (nextLowStock !== null && Number.isFinite(nextLowStock) && nextLowStock >= 0) update.low_stock_threshold_default = nextLowStock;

    const { data: updated, error: uerr } = await supabase
      .from("stores")
      .update(update)
      .eq("store_id", store_id)
      .select("store_id,store_name,store_settings_json,allow_negative_stock,low_stock_threshold_default,owner_pin_hash")
      .single();
    if (uerr) throw new Error(uerr.message);

    return jsonOk({ store_settings: { ...updated.store_settings_json, store_name: updated.store_name, allow_negative_stock: updated.allow_negative_stock, low_stock_threshold_default: updated.low_stock_threshold_default, owner_pin_hash: updated.owner_pin_hash } });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
