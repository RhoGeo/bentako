import { normalizeBarcode } from "@/components/lib/deviceId";

export function getEffectiveThresholds(product, settings) {
  const lowDefault = Number(settings?.low_stock_threshold_default ?? 5);
  const low = Number(product?.low_stock_threshold ?? lowDefault);
  const criticalDefault = Number(settings?.critical_stock_threshold_default ?? Math.max(1, Math.floor(low / 2)));
  const critical = Number(product?.critical_stock_threshold ?? criticalDefault);
  return { low: Number.isFinite(low) ? low : lowDefault, critical: Number.isFinite(critical) ? critical : criticalDefault };
}

export function getStockQty(product) {
  return Number(product?.stock_quantity ?? product?.stock_qty ?? 0);
}

export function getInventoryTag(product, settings) {
  if (!product?.track_stock) return { tag: "safe", label: "Safe" };
  const qty = getStockQty(product);
  const { low, critical } = getEffectiveThresholds(product, settings);
  if (qty <= 0) return { tag: "out", label: "Out of Stock" };
  if (qty <= critical) return { tag: "critical", label: "Critical" };
  if (qty <= low) return { tag: "low", label: "Low" };
  return { tag: "safe", label: "Safe" };
}

export function normalizeForMatch(p) {
  return {
    name: (p?.name || "").toString().toLowerCase(),
    barcode: normalizeBarcode(p?.barcode || ""),
    category: (p?.category || "").toString().toLowerCase(),
  };
}
