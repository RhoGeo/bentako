import { normalizeBarcode } from "./barcode.ts";

/**
 * Enforces prompt rules:
 * - Parent products are not sellable and must be excluded from barcode uniqueness/lookup.
 * - Unique barcode per store for sellable items only (variants + non-parent products).
 */

export async function assertUniqueBarcodeForSellable(
  base44: any,
  args: {
    store_id: string;
    barcode: unknown;
    /** The current product id (if updating). */
    exclude_product_id?: string | null;
  }
): Promise<{ normalized: string }>{
  const normalized = normalizeBarcode(args.barcode);
  if (!normalized) return { normalized: "" };

  // Search among sellable items only.
  // In this codebase, sellable = Product.product_type === "single" AND is_active !== false.
  const matches = (await base44.asServiceRole.entities.Product.filter({
    store_id: args.store_id,
    product_type: "single",
    barcode: normalized,
    is_active: true,
  })) || [];

  const conflict = matches.find((p: any) => p?.id && p.id !== args.exclude_product_id);
  if (conflict) {
    throw Object.assign(new Error(`Barcode already used in this store: ${normalized}`), {
      code: "BARCODE_CONFLICT",
      details: { barcode: normalized, conflict_product_id: conflict.id },
    });
  }
  return { normalized };
}

export function assertProductSellable(product: any) {
  if (!product) {
    throw Object.assign(new Error("Product not found"), { code: "BAD_REQUEST" });
  }
  if (product.product_type === "parent") {
    throw Object.assign(new Error("Parent products are not sellable"), { code: "BAD_REQUEST" });
  }
}
