import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonFailFromError, jsonOk } from "../_shared/response.ts";
import { requireAuth, listMembershipsAndStores } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);

    const body = await req.json();
    const store_name = String(body?.store_name ?? "").trim();
    if (!store_name) return jsonFail(400, "BAD_REQUEST", "store_name required");

    // Ensure they don't already have a membership (we still allow creating new store, but prompt says first store only)
    const { memberships: existingMemberships } = await listMembershipsAndStores(user.user_id);

    const { data: store, error: sErr } = await supabase
      .from("stores")
      .insert({
        store_name,
        created_by: user.user_id,
      })
      .select("store_id,store_code,store_name,store_settings_json,low_stock_threshold_default,allow_negative_stock")
      .single();
    if (sErr) throw new Error(`Failed to create store: ${sErr.message}`);

    const { data: membership, error: mErr } = await supabase
      .from("store_memberships")
      .insert({
        store_id: store.store_id,
        user_id: user.user_id,
        role: "owner",
        is_active: true,
        created_by: user.user_id,
      })
      .select("store_membership_id,store_id,user_id,role,permission_set_id,overrides_json,is_active")
      .single();
    if (mErr) throw new Error(`Failed to create membership: ${mErr.message}`);

    return jsonOk({
      store,
      membership,
      note: existingMemberships.length ? "User already had memberships; created additional store." : undefined,
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
