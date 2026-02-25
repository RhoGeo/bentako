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

    await requireStoreAccess({ user_id: user.user_id, store_id });

    const { data, error } = await supabase
      .from("store_memberships")
      .select("store_membership_id,store_id,user_id,role,overrides_json,is_active,user_accounts(full_name,email)")
      .eq("store_id", store_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const members = (data || []).map((m: any) => ({
      id: m.store_membership_id,
      membership_id: m.store_membership_id,
      store_id: m.store_id,
      user_id: m.user_id,
      user_name: m.user_accounts?.full_name || null,
      user_email: m.user_accounts?.email || null,
      role: m.role,
      overrides_json: m.overrides_json || {},
      is_active: m.is_active,
    }));

    return jsonOk({ members });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
