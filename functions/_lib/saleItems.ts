/**
 * saleItems — helpers to make sale processing idempotent + retail-correct.
 */

export type SaleLine = {
  product_id: string;
  qty: number;
  unit_price_centavos: number;
  line_discount_centavos?: number;
};

/**
 * Normalize sale items by merging identical lines.
 * Key: product_id + unit_price_centavos + line_discount_centavos.
 */
export function normalizeSaleItems(items: any[]): SaleLine[] {
  const arr = Array.isArray(items) ? items : [];
  const map = new Map<string, SaleLine>();
  for (const raw of arr) {
    const product_id = String(raw?.product_id || "").trim();
    if (!product_id) continue;
    const qty = Number(raw?.qty || 0);
    const unit_price_centavos = Number(raw?.unit_price_centavos || 0);
    const line_discount_centavos = Number(raw?.line_discount_centavos || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = `${product_id}::${unit_price_centavos}::${line_discount_centavos}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += qty;
    } else {
      map.set(key, { product_id, qty, unit_price_centavos, line_discount_centavos });
    }
  }
  return Array.from(map.values());
}

export function sumQtyByProduct(items: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of Array.isArray(items) ? items : []) {
    const pid = String(it?.product_id || "").trim();
    if (!pid) continue;
    const qty = Number(it?.qty || 0);
    if (!Number.isFinite(qty) || qty === 0) continue;
    out[pid] = (out[pid] || 0) + qty;
  }
  return out;
}
