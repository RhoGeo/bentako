import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

function int(v: unknown, dflt: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();

    const store_id = str(body?.store_id);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "reports_access" });

    const window_days = int(body?.window_days, 30);

    const { data, error } = await supabase.rpc("posync_inventory_metrics", {
      p_store_id: store_id,
      p_actor_user_id: user.user_id,
      p_window_days: window_days,
    });
    if (error) throw new Error(error.message);

    return jsonOk(data || {});
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
