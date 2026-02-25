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
    const invite_id = str(body?.invite_id);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!invite_id) return jsonFail(400, "BAD_REQUEST", "invite_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "staff_manage" });

    const { error } = await supabase
      .from("invitation_codes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("invitation_code_id", invite_id)
      .eq("store_id", store_id)
      .eq("type", "staff_invite");
    if (error) throw new Error(error.message);

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
