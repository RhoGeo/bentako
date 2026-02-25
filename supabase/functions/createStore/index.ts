import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
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
    const store_name = str(body?.store_name);
    if (store_name.length < 2) return jsonFail(400, "BAD_REQUEST", "store_name is required");

    const { data: store, error: serr } = await supabase
      .from("stores")
      .insert({ store_name, created_by: user.user_id })
      .select("store_id,store_name,store_code,allow_negative_stock,low_stock_threshold_default,store_settings_json")
      .single();
    if (serr) throw new Error(serr.message);

    const { data: membership, error: merr } = await supabase
      .from("store_memberships")
      .insert({
        store_id: store.store_id,
        user_id: user.user_id,
        role: "owner",
        is_active: true,
        created_by: user.user_id,
      })
      .select("store_membership_id,store_id,role,overrides_json,is_active")
      .single();
    if (merr) throw new Error(merr.message);

    return jsonOk({
      store: { id: store.store_id, store_id: store.store_id, store_name: store.store_name, store_code: store.store_code },
      membership,
    });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
