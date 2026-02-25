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

    const { error: rpcErr } = await supabase.rpc("posync_update_store_permissions", {
      p_store_id: store_id,
      p_actor_user_id: user.user_id,
      p_role_permissions_manager_json: manager || null,
      p_role_permissions_cashier_json: cashier || null,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
