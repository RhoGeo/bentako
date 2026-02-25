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

    const body = await req.json().catch(() => ({}));
    const include_archived = !!body?.include_archived;

    const { data: memberships, error: merr } = await supabase
      .from("store_memberships")
      .select("store_membership_id,store_id,role,permission_set_id,overrides_json,is_active")
      .eq("user_id", user.user_id)
      .eq("is_active", true);
    if (merr) throw new Error(merr.message);

    const storeIds = (memberships || []).map((m) => m.store_id);
    if (storeIds.length === 0) {
      return jsonOk({ memberships: [], stores: [] });
    }

    let q = supabase
      .from("stores")
      .select(
        "store_id,store_name,store_code,store_settings_json,low_stock_threshold_default,allow_negative_stock,archived_at,deleted_at,created_at,updated_at"
      )
      .in("store_id", storeIds)
      .is("deleted_at", null);

    if (!include_archived) q = q.is("archived_at", null);

    const { data: stores, error: serr } = await q;
    if (serr) throw new Error(serr.message);

    const storeIdToMembership = new Map((memberships || []).map((m) => [m.store_id, m]));
    const normalizedStores = (stores || []).map((s) => {
      const sid = s.store_id;
      const m = storeIdToMembership.get(sid) || null;
      return {
        id: sid,
        store_id: sid,
        store_name: s.store_name,
        store_code: s.store_code,
        archived_at: s.archived_at,
        is_archived: !!s.archived_at,
        membership: m,
      };
    });

    return jsonOk({ memberships: memberships || [], stores: normalizedStores });
  } catch (err) {
    // If auth is missing, the caller will re-route.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AUTH_REQUIRED") || msg.includes("AUTH_EXPIRED")) {
      return jsonFail(401, "AUTH_REQUIRED", "Authentication required");
    }
    return mapErrorToResponse(err);
  }
});
