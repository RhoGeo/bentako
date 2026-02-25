import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import { productRowToSnapshot, type DbProductRow } from "../_shared/snapshots.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

function toCentavos(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function toInt(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function normalizeBarcode(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);

    const body = await req.json();
    const store_id = str(body?.store_id);
    const product = body?.product ?? {};
    const variantsIn = Array.isArray(body?.variants) ? body.variants : [];

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireStoreAccess({ user_id: user.user_id, store_id });

    const product_type = str(product?.product_type || product?.type || "single");
    const is_parent = product_type === "parent";

    const product_id = str(product?.id || product?.product_id || "") || null;
    const name = str(product?.name);
    if (!name) return jsonFail(400, "BAD_REQUEST", "Name is required");

    const category_name = str(product?.category || "") || null;

    const barcode = !is_parent ? normalizeBarcode(product?.barcode) : null;
    const price_centavos = !is_parent ? toCentavos(product?.selling_price_centavos ?? product?.price_centavos ?? 0) : 0;
    const cost_price_centavos = !is_parent ? toCentavos(product?.cost_price_centavos ?? 0) : 0;

    const track_stock = !is_parent ? !!product?.track_stock : false;
    const stock_quantity = !is_parent ? toInt(product?.stock_qty ?? product?.stock_quantity ?? 0) : 0;
    const low_stock_threshold = toInt(product?.low_stock_threshold ?? 0);

    if (!is_parent) {
      if (cost_price_centavos <= 0) return jsonFail(400, "BAD_REQUEST", "Cost price is required");
      if (price_centavos < 0) return jsonFail(400, "BAD_REQUEST", "Price must be >= 0");
    }

    const variants = is_parent
      ? variantsIn.map((v: any) => {
          const vId = str(v?.id || v?.product_id || "") || null;
          const vName = str(v?.name || v?.variant_name);
          const vBarcode = normalizeBarcode(v?.barcode);
          const vPrice = toCentavos(v?.selling_price_centavos ?? v?.price_centavos ?? 0);
          const vCost = toCentavos(v?.cost_price_centavos ?? 0);
          const vTrack = !!v?.track_stock;
          const vStock = toInt(v?.stock_qty ?? v?.stock_quantity ?? 0);
          const vLow = toInt(v?.low_stock_threshold ?? 0);
          return {
            id: vId,
            name: vName,
            barcode: vBarcode,
            price_centavos: vPrice,
            cost_price_centavos: vCost,
            track_stock: vTrack,
            stock_quantity: vStock,
            low_stock_threshold: vLow,
          };
        })
      : [];

    if (is_parent) {
      if (variants.length === 0) return jsonFail(400, "BAD_REQUEST", "At least 1 variant is required");
      const seen = new Set<string>();
      for (const v of variants) {
        if (!v.name) return jsonFail(400, "BAD_REQUEST", "Variant name is required");
        if (v.cost_price_centavos <= 0) return jsonFail(400, "BAD_REQUEST", "Variant cost price is required");
        if (v.price_centavos < 0) return jsonFail(400, "BAD_REQUEST", "Variant price must be >= 0");
        if (v.barcode) {
          if (seen.has(v.barcode)) return jsonFail(400, "BAD_REQUEST", `Duplicate barcode in variants: ${v.barcode}`);
          seen.add(v.barcode);
        }
      }
    }

    // Transactional upsert via SQL RPC.
    const { data: newId, error } = await supabase.rpc("posync_upsert_product", {
      p_store_id: store_id,
      p_user_id: user.user_id,
      p_product_id: product_id,
      p_is_parent: is_parent,
      p_name: name,
      p_category_name: category_name,
      p_barcode: barcode,
      p_price_centavos: price_centavos,
      p_cost_price_centavos: cost_price_centavos,
      p_track_stock: track_stock,
      p_stock_quantity: stock_quantity,
      p_low_stock_threshold: low_stock_threshold,
      p_variants: is_parent ? variants : null,
    });

    if (error) throw new Error(error.message);

    const parentId = String(newId);

    // Return freshly mapped snapshots (including Parent + Variant naming)
    const { data: parentRow, error: pErr } = await supabase
      .from("products")
      .select(
        "product_id,store_id,is_parent,parent_product_id,name,barcode,price_centavos,cost_price_centavos,track_stock,stock_quantity,low_stock_threshold,is_active,created_at,updated_at,deleted_at,category:categories(name),parent:products!products_parent_product_id_fkey(name)"
      )
      .eq("store_id", store_id)
      .eq("product_id", parentId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);

    const productSnapshot = parentRow ? productRowToSnapshot(parentRow as any as DbProductRow) : null;

    let variantSnapshots: any[] = [];
    if (is_parent) {
      const { data: vRows, error: vErr } = await supabase
        .from("products")
        .select(
          "product_id,store_id,is_parent,parent_product_id,name,barcode,price_centavos,cost_price_centavos,track_stock,stock_quantity,low_stock_threshold,is_active,created_at,updated_at,deleted_at,category:categories(name),parent:products!products_parent_product_id_fkey(name)"
        )
        .eq("store_id", store_id)
        .eq("parent_product_id", parentId)
        .eq("is_parent", false)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (vErr) throw new Error(vErr.message);
      variantSnapshots = (vRows || []).map((r: any) => productRowToSnapshot(r as any as DbProductRow));
    }

    return jsonOk({ product_id: parentId, product: productSnapshot, variants: variantSnapshots });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
