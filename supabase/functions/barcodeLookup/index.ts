import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import { productRowToSnapshot } from "../_shared/snapshots.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";

function normalizeBarcode(input: unknown): string {
  const s = String(input ?? "").trim();
  // reject non-printable
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) throw new Error("Invalid barcode");
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);

    const body = await req.json();
    const store_id = String(body?.store_id ?? "").trim();
    const barcode = normalizeBarcode(body?.barcode);

    if (!store_id || !barcode) return jsonFail(400, "BAD_REQUEST", "store_id and barcode required");

    await requireStoreAccess({ user_id: user.user_id, store_id });

    const { data: rows, error } = await supabase
      .from("products")
      .select(
        "product_id,store_id,parent_product_id,is_parent,name,barcode,price_centavos,cost_price_centavos,track_stock,stock_quantity,low_stock_threshold,is_active,created_at,updated_at,deleted_at,category:categories(name),parent:products!parent_product_id(name)"
      )
      .eq("store_id", store_id)
      .eq("barcode", barcode)
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(10);

    if (error) throw new Error(error.message);

    const sellables = (rows ?? []).filter((p: any) => !p.is_parent);
    if (sellables.length === 0) {
      return jsonFail(404, "NOT_FOUND", "Barcode not found");
    }

    // Prefer variants (parent_product_id not null)
    sellables.sort((a: any, b: any) => {
      const av = a.parent_product_id ? 0 : 1;
      const bv = b.parent_product_id ? 0 : 1;
      return av - bv;
    });

    return jsonOk({ product: productRowToSnapshot(sellables[0] as any) });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
