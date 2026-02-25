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
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "staff_manage" });

    const { data, error } = await supabase
      .from("invitation_codes")
      .select("invitation_code_id,code,invite_email,role,used_count,max_uses,expires_at,revoked_at,created_at")
      .eq("store_id", store_id)
      .eq("type", "staff_invite")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const invites = (data || []).map((r: any) => ({
      invite_id: r.invitation_code_id,
      invite_token: r.code,
      invite_email: r.invite_email,
      role: r.role,
      used_count: r.used_count,
      max_uses: r.max_uses,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      created_at: r.created_at,
    }));

    return jsonOk({ invites });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
