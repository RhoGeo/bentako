import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
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
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const membership = await requireStoreAccess({ user_id: user.user_id, store_id });
    if (membership.role !== "owner") return jsonFail(403, "FORBIDDEN", "Owner only");

    const { error } = await supabase
      .from("stores")
      .update({ archived_at: new Date().toISOString(), archived_by: user.user_id })
      .eq("store_id", store_id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
