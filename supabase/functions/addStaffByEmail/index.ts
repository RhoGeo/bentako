import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function emailCanon(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}
function str(v: unknown) {
  return String(v ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();

    const body = await req.json();
    const store_id = str(body?.store_id);
    const user_email = emailCanon(body?.user_email);
    const role = str(body?.role || "cashier") || "cashier";

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!user_email || !user_email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Valid user_email required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "staff_manage" });

    const { error: rpcErr } = await supabase.rpc("posync_add_staff_by_email", {
      p_store_id: store_id,
      p_actor_user_id: user.user_id,
      p_user_email: user_email,
      p_role: role,
    });
    if (rpcErr) {
      // Normalize not-found into 404
      if ((rpcErr.message || "").toLowerCase().includes("user not found")) {
        return jsonFail(404, "USER_NOT_FOUND", "User not found. They must sign up first.");
      }
      throw new Error(rpcErr.message);
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
