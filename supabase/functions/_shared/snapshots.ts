/**
 * Server → client snapshot mapping.
 *
 * The current UI expects legacy Base44-ish shapes:
 * - id (not product_id/customer_id)
 * - product_type: 'parent'|'single'
 * - parent_id
 * - selling_price_centavos
 * - stock_qty
 * - created_date / updated_date
 */

export type DbProductRow = {
  product_id: string;
  store_id: string;
  is_parent: boolean;
  parent_product_id: string | null;
  name: string;
  barcode: string | null;
  price_centavos: number | null;
  cost_price_centavos: number | null;
  track_stock: boolean;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // optional joins
  category?: { name?: string | null } | null;
  parent?: { name?: string | null } | null;
};

export function productRowToSnapshot(p: DbProductRow) {
  const isParent = !!p.is_parent;

  const stockQ = p.stock_quantity ?? 0;
  const price = p.price_centavos ?? 0;
  const cost = p.cost_price_centavos ?? 0;

  const rawName = (p.name || "").toString();

  const parentName =
    !isParent && p.parent_product_id
      ? ((p as any)?.parent?.name || "").toString()
      : "";

  const variantName =
    !isParent && p.parent_product_id ? rawName : "";

  const displayName =
    !isParent && p.parent_product_id && parentName
      ? `${parentName} ${rawName}`.trim()
      : rawName;

  return {
    id: p.product_id,
    product_id: p.product_id,
    store_id: p.store_id,

    product_type: isParent ? "parent" : "single",
    parent_id: p.parent_product_id,

    // Naming rule:
    // - parent: name is parent name
    // - variant: name is "Parent + Variant", with variant_name kept for editing
    name: displayName,
    parent_name: parentName,
    variant_name: variantName,

    barcode: isParent ? "" : p.barcode || "",

    // Support both naming conventions to avoid breaking older UI components.
    selling_price_centavos: isParent ? 0 : price,
    price_centavos: price,
    cost_price_centavos: isParent ? 0 : cost,

    track_stock: isParent ? false : !!p.track_stock,
    stock_qty: isParent ? 0 : stockQ,
    stock_quantity: isParent ? 0 : stockQ,

    low_stock_threshold: p.low_stock_threshold,
    is_active: p.is_active,

    category: (p as any)?.category?.name || "",

    created_date: p.created_at,
    updated_date: p.updated_at,
    updated_at: p.updated_at,
  };
}

export type DbCustomerRow = {
  customer_id: string;
  store_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  allow_utang: boolean;
  credit_limit_centavos: number | null;
  balance_due_centavos: number;
  notes: string | null;
  last_transaction_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function customerRowToSnapshot(c: DbCustomerRow) {
  return {
    id: c.customer_id,
    customer_id: c.customer_id,
    store_id: c.store_id,
    name: c.name,
    phone: c.phone || "",
    address: c.address || "",
    allow_utang: c.allow_utang,
    credit_limit_centavos: c.credit_limit_centavos,
    balance_due_centavos: c.balance_due_centavos,
    notes: c.notes || "",
    last_transaction_date: c.last_transaction_date,
    created_date: c.created_at,
    updated_date: c.updated_at,
    updated_at: c.updated_at,
  };
}

export type DbCategoryRow = {
  category_id: string;
  store_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function categoryRowToSnapshot(cat: DbCategoryRow) {
  return {
    id: cat.category_id,
    category_id: cat.category_id,
    store_id: cat.store_id,
    name: cat.name,
    sort_order: cat.sort_order,
    is_active: cat.is_active,
    created_date: cat.created_at,
    updated_date: cat.updated_at,
    updated_at: cat.updated_at,
  };
}
