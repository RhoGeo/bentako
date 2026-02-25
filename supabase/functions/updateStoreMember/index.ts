import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
    const membership_id = str(body?.membership_id);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!membership_id) return jsonFail(400, "BAD_REQUEST", "membership_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "staff_manage" });

    const nextRole = body?.role != null ? str(body.role) : null;
    const nextActive = body?.is_active != null ? !!body.is_active : null;
    const nextOverrides = body?.overrides_json != null ? body.overrides_json : null;

    const { error: rpcErr } = await supabase.rpc("posync_update_store_member", {
      p_store_id: store_id,
      p_actor_user_id: user.user_id,
      p_membership_id: membership_id,
      p_role: nextRole,
      p_is_active: nextActive,
      p_overrides: nextOverrides,
    });
    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.toLowerCase().includes("last owner")) {
        return jsonFail(409, "LAST_OWNER", "Cannot remove the last owner of a store.");
      }
      if (msg.toLowerCase().includes("not found")) {
        return jsonFail(404, "NOT_FOUND", "Membership not found");
      }
      throw new Error(msg);
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
