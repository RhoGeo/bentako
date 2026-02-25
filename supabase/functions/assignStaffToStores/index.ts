import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
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

    const store_ids = Array.isArray(body?.store_ids) ? body.store_ids.map(str).filter(Boolean) : [];
    const user_email = emailCanon(body?.user_email);
    const role = str(body?.role || "cashier") || "cashier";

    if (!user_email || !user_email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Valid user_email required");
    if (store_ids.length === 0) return jsonFail(400, "BAD_REQUEST", "store_ids required");

    const { error: rpcErr } = await supabase.rpc("posync_assign_staff_to_stores", {
      p_actor_user_id: user.user_id,
      p_user_email: user_email,
      p_store_ids: store_ids,
      p_role: role,
    });
    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.toLowerCase().includes("user not found")) {
        return jsonFail(404, "USER_NOT_FOUND", "User not found. They must sign up first.");
      }
      if (msg.toLowerCase().includes("owner only")) {
        return jsonFail(403, "FORBIDDEN", "Owner only for multi-store assignment");
      }
      throw new Error(msg);
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
