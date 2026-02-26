import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);

    const body = await req.json();
    const store_id = str(body?.store_id);
    const product_id = str(body?.product_id);
    const note = str(body?.note || "");

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!product_id) return jsonFail(400, "BAD_REQUEST", "product_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "inventory_create_edit" });

    const { data, error } = await supabase.rpc("posync_delete_product", {
      p_store_id: store_id,
      p_user_id: user.user_id,
      p_product_id: product_id,
      p_note: note || null,
    });
    if (error) throw new Error(error.message);

    return jsonOk({ result: data });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
