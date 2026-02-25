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

    const nextStoreName = body?.store_name != null ? str(body.store_name) : null;
    const nextAllowNegative = body?.allow_negative_stock != null ? !!body.allow_negative_stock : null;
    const nextLowStock = body?.low_stock_threshold_default != null ? Number(body.low_stock_threshold_default) : null;

    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (!SETTINGS_KEYS.has(k)) continue;
      patch[k] = v;
    }

    const { data, error: rpcErr } = await supabase.rpc("posync_update_store_settings", {
      p_store_id: store_id,
      p_actor_user_id: user.user_id,
      p_store_name: nextStoreName,
      p_allow_negative_stock: nextAllowNegative,
      p_low_stock_threshold_default: Number.isFinite(nextLowStock) ? Math.trunc(nextLowStock) : null,
      p_patch: patch,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return jsonOk({ store_settings: data || {} });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
