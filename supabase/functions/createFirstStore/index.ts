import { ok, fail, json, readJson } from "../_shared/http.ts";
import { requireAuth, listMembershipsAndStores } from "../_shared/auth.ts";
import { getServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, { status: 200 });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use POST", undefined, 405);

  try {
    const { user } = await requireAuth(req);
    const body = await readJson(req);
    const store_name = (body.store_name ?? "").toString().trim();
    if (store_name.length < 2) return fail("VALIDATION", "Store name is required");

    const supabase = getServiceClient();

    // Create store
    const { data: stores, error: serr } = await supabase
      .from("stores")
      .insert({ store_name, created_by: user.user_id })
      .select("store_id,store_name,store_code")
      .limit(1);
    if (serr) return fail("DB_ERROR", "Failed to create store", serr, 500);
    const store = stores?.[0];
    if (!store) return fail("DB_ERROR", "Failed to create store", undefined, 500);

    // Create owner membership
    const { error: merr } = await supabase
      .from("store_memberships")
      .insert({ store_id: store.store_id, user_id: user.user_id, role: "owner", created_by: user.user_id, is_active: true });
    if (merr) return fail("DB_ERROR", "Failed to create membership", merr, 500);

    const { memberships, stores: accessibleStores } = await listMembershipsAndStores(user.user_id);

    return ok({ store, membership_created: true, memberships, stores: accessibleStores });
  } catch (e) {
    const msg = e?.message || String(e);
    const code = msg === "AUTH_REQUIRED" || msg === "AUTH_EXPIRED" ? "AUTH_REQUIRED" : "SERVER_ERROR";
    return fail(code, code === "AUTH_REQUIRED" ? "Authentication required" : msg, e, 401);
  }
});
