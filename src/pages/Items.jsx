import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/api/posyncClient";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import BarcodeScannerModal from "@/components/global/BarcodeScannerModal";
import WedgeScannerInput from "@/components/counter/WedgeScannerInput";
import CentavosDisplay from "@/components/shared/CentavosDisplay";

import { Plus, Package, TrendingDown, TrendingUp, AlertTriangle, XCircle } from "lucide-react";

import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { normalizeBarcode, normalizeBarcode as normalizeBc } from "@/lib/ids/deviceId";
import {
  getCachedProductByBarcode,
  getAllCachedProducts,
  upsertCachedProducts,
} from "@/lib/db";

import { getInventoryTag, getStockQty, normalizeForMatch, getEffectiveThresholds } from "@/components/inventory/inventoryRules";
import InventoryTagBadge from "@/components/inventory/InventoryTagBadge";
import RestockItemDrawer from "@/components/inventory/RestockItemDrawer";
import CsvRestockCard from "@/components/inventory/CsvRestockCard";

const VIEW_FILTERS = ["All", "Critical", "Low", "Out of Stock"];

const SORT_OPTIONS = [
  { key: "slow", label: "Slow Moving" },
  { key: "fast", label: "Fast Moving" },
  { key: "stock_asc", label: "Stock (Low to High)" },
  { key: "stock_desc", label: "Stock (High to Low)" },
  { key: "name_asc", label: "Name (A-Z)" },
  { key: "name_desc", label: "Name (Z-A)" },
];

function getSortFn(key) {
  if (key === "slow") return (a, b) => a.monthlySold - b.monthlySold;
  if (key === "fast") return (a, b) => b.monthlySold - a.monthlySold;
  if (key === "stock_asc") return (a, b) => a.qty - b.qty;
  if (key === "stock_desc") return (a, b) => b.qty - a.qty;
  if (key === "name_desc") return (a, b) => b.name.localeCompare(a.name);
  return (a, b) => a.name.localeCompare(b.name);
}

export default function Items() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { settings } = useStoreSettings(storeId);

  const urlParams = new URLSearchParams(window.location.search);
  const initialFilter = urlParams.get("filter");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef(null);
  const [autoAddOnEnter, setAutoAddOnEnter] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [offlineProducts, setOfflineProducts] = useState([]);

  const [activeFilter, setActiveFilter] = useState(
    initialFilter === "low_stock"
      ? "Low"
      : initialFilter === "out_of_stock"
      ? "Out of Stock"
      : initialFilter === "critical"
      ? "Critical"
      : "All"
  );
  const [sortKey, setSortKey] = useState("stock_asc");

  const [restockOpen, setRestockOpen] = useState(false);
  const [restockProduct, setRestockProduct] = useState(null);

  const { data: serverProducts = [], isLoading } = useQuery({
    queryKey: ["products-all", storeId],
    enabled: !!storeId && navigator.onLine,
    queryFn: async () => {
      const res = await invokeFunction("listProducts", { store_id: storeId });
      const products = res?.data?.products || [];
      await upsertCachedProducts(products, storeId);
      return products;
    },
    initialData: [],
  });

  useEffect(() => {
    const load = async () => {
      const cached = await getAllCachedProducts(storeId);
      setOfflineProducts(cached);
    };
    load();
  }, [storeId]);

  const products = serverProducts.length > 0 ? serverProducts : offlineProducts;

  const { data: metrics } = useQuery({
    queryKey: ["inventory-metrics", storeId],
    enabled: !!storeId && navigator.onLine,
    queryFn: async () => {
      const r = await invokeFunction("getInventoryMetrics", { store_id: storeId, window_days: 30 });
      return r?.data || r?.data?.data;
    },
    staleTime: 60_000,
  });

  const monthlySoldMap = metrics?.monthly_sold_by_product || {};

  const handleSearchChange = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 180);
  };

  const lookupBarcode = useCallback(
    async (barcode) => {
      const bc = normalizeBarcode(barcode);
      if (!bc) return null;

      const cached = await getCachedProductByBarcode(storeId, bc);
      if (cached) return cached;

      const inMem = products.find((p) => normalizeBc(p.barcode) === bc && p.product_type !== "parent");
      if (inMem) return inMem;

      if (navigator.onLine) {
        try {
          const res = await invokeFunction("barcodeLookup", { store_id: storeId, barcode: bc });
          return res?.data?.product || res?.data?.data?.product || null;
        } catch (_e) {
          return null;
        }
      }
      return null;
    },
    [storeId, products]
  );

  const handleEnterSubmit = useCallback(
    async (val) => {
      const bc = normalizeBarcode(val);
      if (!bc) return;
      const p = await lookupBarcode(bc);
      if (p) {
        if (autoAddOnEnter) {
          navigate(createPageUrl("ProductForm") + `?id=${p.id}`);
          setSearch("");
          return;
        }
        // If Auto-add is OFF, treat Enter as a barcode search.
        setSearch(bc);
        setDebouncedSearch(bc);
        toast.message("Found item — showing in list", { duration: 1100 });
        return;
      }
      toast.warning("Barcode not found", { duration: 1400 });
    },
    [lookupBarcode, autoAddOnEnter, navigate]
  );

  const computed = useMemo(() => {
    const sellable = (products || []).filter((p) => p.product_type !== "parent" && p.is_active !== false);

    const rows = sellable.map((p) => {
      const qty = getStockQty(p);
      const tag = getInventoryTag(p, settings);
      const thresholds = getEffectiveThresholds(p, settings);
      const monthlySold = Number(monthlySoldMap[p.id] || 0);
      const match = normalizeForMatch(p);
      return {
        id: p.id,
        name: (p.name || "").toString(),
        barcode: p.barcode || "",
        product: p,
        qty,
        tag: tag.tag,
        tagLabel: tag.label,
        thresholds,
        monthlySold,
        match,
      };
    });

    const counts = {
      total: rows.length,
      safe: 0,
      low: 0,
      critical: 0,
      out: 0,
    };

    for (const r of rows) {
      if (!r.product.track_stock) {
        counts.safe += 1;
        continue;
      }
      counts[r.tag] += 1;
    }

    return { rows, counts };
  }, [products, settings, monthlySoldMap]);

  const filtered = useMemo(() => {
    let list = computed.rows;

    if (activeFilter === "Critical") {
      list = list.filter((r) => r.product.track_stock && (r.tag === "critical" || r.tag === "out"));
    } else if (activeFilter === "Low") {
      list = list.filter((r) => r.product.track_stock && (r.tag === "low" || r.tag === "critical" || r.tag === "out"));
    } else if (activeFilter === "Out of Stock") {
      list = list.filter((r) => r.product.track_stock && r.tag === "out");
    }

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((r) => r.match.name.includes(q) || r.match.category.includes(q) || (r.barcode || "").includes(debouncedSearch));
    }

    list = list.slice().sort(getSortFn(sortKey));
    return list;
  }, [computed.rows, activeFilter, debouncedSearch, sortKey]);

  return (
    <div className="pb-24">
      {/* Inventory Counts */}
      <div className="px-4 pt-4 space-y-3">
        <Card className="border-stone-100 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Inventory Counts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => setActiveFilter("All")}
                className={`rounded-xl border p-3 text-center ${activeFilter === "All" ? "border-blue-200 bg-blue-50" : "border-stone-200 bg-white"}`}
              >
                <div className="text-[11px] text-stone-500">Total</div>
                <div className="text-xl font-bold text-stone-800">{computed.counts.total}</div>
              </button>
              <button
                onClick={() => setActiveFilter("Critical")}
                className={`rounded-xl border p-3 text-center ${activeFilter === "Critical" ? "border-red-200 bg-red-50" : "border-stone-200 bg-white"}`}
              >
                <div className="text-[11px] text-red-700">Critical</div>
                <div className="text-xl font-bold text-red-800">{computed.counts.critical + computed.counts.out}</div>
              </button>
              <button
                onClick={() => setActiveFilter("Low")}
                className={`rounded-xl border p-3 text-center ${activeFilter === "Low" ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-white"}`}
              >
                <div className="text-[11px] text-amber-700">Low</div>
                <div className="text-xl font-bold text-amber-800">{computed.counts.low}</div>
              </button>
              <button
                onClick={() => setActiveFilter("Out of Stock")}
                className={`rounded-xl border p-3 text-center ${activeFilter === "Out of Stock" ? "border-red-200 bg-red-50" : "border-stone-200 bg-white"}`}
              >
                <div className="text-[11px] text-red-700">Out</div>
                <div className="text-xl font-bold text-red-800">{computed.counts.out}</div>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* CSV + Restock checklist cards */}
        <CsvRestockCard storeId={storeId} settings={settings} products={computed.rows.map((r) => r.product)} />

        <Card className="border-stone-100 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Restock Checklists</CardTitle>
            <p className="text-xs text-stone-500">Restock only what you selected (Critical / Low / All stocked).</p>
          </CardHeader>
          <CardContent>
            <Button className="w-full h-11 bg-blue-600 hover:bg-blue-700" onClick={() => navigate(createPageUrl("RestockChecklist"))}>
              Start Restocking
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Search + Sort + Add */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <WedgeScannerInput
              value={search}
              onChange={handleSearchChange}
              onEnterSubmit={handleEnterSubmit}
              autoAddOnEnter={autoAddOnEnter}
              setAutoAddOnEnter={setAutoAddOnEnter}
              placeholder="Search items or scan barcode…"
              onScanIconClick={() => setScannerOpen(true)}
            />
          </div>
          <Button
            onClick={() => navigate(createPageUrl("ProductForm"))}
            className="h-12 w-12 bg-blue-600 hover:bg-blue-700 p-0 rounded-xl touch-target"
            title="Add new product"
          >
            <Plus className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {VIEW_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all no-select ${
                  activeFilter === f ? "bg-blue-600 text-white" : "bg-white text-stone-600 border border-stone-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="w-[190px] flex-shrink-0">
            <Select value={sortKey} onValueChange={setSortKey}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Product list */}
      <div className="px-4 space-y-2">
        {isLoading ? (
          <div className="text-center py-12 text-stone-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-400">Walang nakita.</p>
          </div>
        ) : (
          filtered.map((row) => {
            const product = row.product;
            const qty = row.qty;
            const price = product.selling_price_centavos;
            const monthlySold = row.monthlySold;

            const showTrend = monthlySold <= 2 ? "slow" : monthlySold >= 15 ? "fast" : "mid";

            return (
              <div
                key={product.id}
                className="w-full bg-white rounded-2xl p-4 border border-stone-100 shadow-sm flex items-center gap-3 text-left"
                role="button"
                tabIndex={0}
                onClick={() => navigate(createPageUrl("ProductForm") + `?id=${product.id}`)}
              >
                <div className="w-12 h-12 rounded-xl bg-stone-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {/* If product has image_url, show it; else fallback icon */}
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-6 h-6 text-stone-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm text-stone-800 truncate">{product.name}</p>
                    <InventoryTagBadge tag={row.tag} label={row.tagLabel} />
                  </div>

                  <div className="mt-1 flex items-center justify-between">
                    <CentavosDisplay centavos={price} size="sm" className="text-stone-700" />
                    <div className="text-[11px] text-stone-500">Stock: <span className="font-semibold text-stone-700">{qty}</span></div>
                  </div>

                  <div className="mt-1 flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[11px] text-stone-500">
                      {showTrend === "slow" ? (
                        <TrendingDown className="w-3 h-3 text-stone-400" />
                      ) : showTrend === "fast" ? (
                        <TrendingUp className="w-3 h-3 text-stone-400" />
                      ) : null}
                      <span>Monthly sold: <span className="font-semibold text-stone-700">{monthlySold}</span></span>
                    </div>
                    {product.track_stock ? (
                      <div className="flex items-center gap-1">
                        {row.tag === "out" ? (
                          <XCircle className="w-3 h-3 text-red-500" />
                        ) : row.tag === "low" || row.tag === "critical" ? (
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <button
                  className="h-12 w-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center flex-shrink-0 touch-target"
                  title="Add stocks"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRestockProduct(product);
                    setRestockOpen(true);
                  }}
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Scanner */}
      <BarcodeScannerModal
        open={scannerOpen}
        mode="single"
        context="items"
        onLookup={async (barcode) => {
          const p = await lookupBarcode(barcode);
          if (p) {
            setScannerOpen(false);
            navigate(createPageUrl("ProductForm") + `?id=${p.id}`);
            return { found: true, handled: true, label: p.name };
          }
          return { found: false };
        }}
        onNotFound={(barcode) => {
          if (!navigator.onLine) {
            toast.info("Not in offline catalog. Connect to internet to add this item.", { duration: 1600 });
          }
        }}
        onAddNew={(barcode) => {
          setScannerOpen(false);
          navigate(createPageUrl("ProductForm") + `?barcode=${barcode}`);
        }}
        onClose={() => setScannerOpen(false)}
      />

      {/* Restock drawer */}
      <RestockItemDrawer
        open={restockOpen}
        onClose={() => setRestockOpen(false)}
        storeId={storeId}
        settings={settings}
        product={restockProduct}
        monthlySold={Number(monthlySoldMap?.[restockProduct?.id] || 0)}
        onQueued={async () => {
          // refresh offline products view and server query (if online)
          const cached = await getAllCachedProducts(storeId);
          setOfflineProducts(cached);
          queryClient.invalidateQueries({ queryKey: ["products-all", storeId] });
        }}
      />
    </div>
  );
}