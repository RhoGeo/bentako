import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

async function countForStore(supabase: any, table: string, store_id: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("store_id", { count: "exact", head: true })
    .eq("store_id", store_id);
  if (error) throw new Error(error.message);
  return Number(count || 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();

    const body = await req.json();
    const store_id = str(body?.store_id);
    const confirm_has_data = body?.confirm_has_data === true;
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const membership = await requireStoreAccess({ user_id: user.user_id, store_id });
    if (membership.role !== "owner") return jsonFail(403, "FORBIDDEN", "Owner only");

    const [products, customers, sales] = await Promise.all([
      countForStore(supabase, "products", store_id),
      countForStore(supabase, "customers", store_id),
      countForStore(supabase, "sales", store_id),
    ]);

    const hasData = products + customers + sales > 0;
    if (hasData && !confirm_has_data) {
      return jsonFail(
        409,
        "CONFIRM_REQUIRED",
        "Store has existing data. Confirm deletion by passing confirm_has_data=true.",
        { products, customers, sales }
      );
    }

    const now = new Date().toISOString();
    const { error: uerr } = await supabase
      .from("stores")
      .update({ deleted_at: now, archived_at: now, archived_by: user.user_id })
      .eq("store_id", store_id);
    if (uerr) throw new Error(uerr.message);

    // Deactivate memberships so the store is fully inaccessible.
    const { error: merr } = await supabase
      .from("store_memberships")
      .update({ is_active: false })
      .eq("store_id", store_id);
    if (merr) throw new Error(merr.message);

    return jsonOk({ ok: true, has_data: hasData });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
