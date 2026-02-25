import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

function safeObj(v: unknown): Record<string, boolean> | null {
  if (!v) return null;
  if (typeof v === "object") return v as Record<string, boolean>;
  try {
    const o = JSON.parse(String(v));
    return typeof o === "object" ? (o as any) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();

    const store_id = str(body?.store_id);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "permissions_manage" });

    const manager = safeObj(body?.role_permissions_manager_json);
    const cashier = safeObj(body?.role_permissions_cashier_json);
    if (!manager && !cashier) return jsonFail(400, "BAD_REQUEST", "No permissions payload provided");

    const { data: store, error: serr } = await supabase
      .from("stores")
      .select("store_settings_json")
      .eq("store_id", store_id)
      .single();
    if (serr) throw new Error(serr.message);

    const merged = { ...(store.store_settings_json || {}) };
    if (manager) merged.role_permissions_manager_json = manager;
    if (cashier) merged.role_permissions_cashier_json = cashier;

    const { error: uerr } = await supabase
      .from("stores")
      .update({ store_settings_json: merged })
      .eq("store_id", store_id);
    if (uerr) throw new Error(uerr.message);

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
