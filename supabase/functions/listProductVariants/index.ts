import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import { productRowToSnapshot, type DbProductRow } from "../_shared/snapshots.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);

    const body = await req.json();
    const store_id = String(body?.store_id || "").trim();
    const parent_product_id = String(body?.parent_product_id || "").trim();

    if (!store_id || !parent_product_id) {
      return jsonFail(400, "BAD_REQUEST", "store_id and parent_product_id required");
    }

    await requireStoreAccess({ user_id: user.user_id, store_id });

    const { data: rows, error } = await supabase
      .from("products")
      .select(
        "product_id,store_id,is_parent,parent_product_id,name,barcode,price_centavos,cost_price_centavos,track_stock,stock_quantity,low_stock_threshold,is_active,created_at,updated_at,deleted_at,category:categories(name),parent:products!parent_product_id(name)"
      )
      .eq("store_id", store_id)
      .eq("parent_product_id", parent_product_id)
      .eq("is_parent", false)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(5000);

    if (error) throw new Error(error.message);

    const variants = ((rows || []) as any as DbProductRow[]).map((p) => productRowToSnapshot(p));

    return jsonOk({ variants });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
