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
    const product_id = String(body?.product_id || "").trim();

    if (!store_id || !product_id) {
      return jsonFail(400, "BAD_REQUEST", "store_id and product_id required");
    }

    await requireStoreAccess({ user_id: user.user_id, store_id });

    const { data: row, error } = await supabase
      .from("products")
      .select(
        "product_id,store_id,is_parent,parent_product_id,name,barcode,price_centavos,cost_price_centavos,track_stock,stock_quantity,low_stock_threshold,is_active,created_at,updated_at,deleted_at,category:categories(name),parent:products!products_parent_product_id_fkey(name)"
      )
      .eq("store_id", store_id)
      .eq("product_id", product_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row || (row as any).deleted_at) return jsonFail(404, "NOT_FOUND", "Product not found");

    const snapshot = productRowToSnapshot(row as any as DbProductRow);
    return jsonOk({ product: snapshot });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
