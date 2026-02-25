import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import {
  TrendingUp,
  ShoppingBag,
  Package,
  AlertTriangle,
  Users,
  BarChart3,
  ArrowRight,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoresForUser } from "@/components/lib/useStores";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { can, guard } from "@/components/lib/permissions";

const DATE_CHIPS = ["Today", "Week", "Month"];

function rangeForChip(chip) {
  const now = new Date();
  const to = new Date(now.getTime() + 60 * 60 * 1000); // buffer
  const from = new Date(now);
  if (chip === "Today") {
    from.setHours(0, 0, 0, 0);
  } else if (chip === "Week") {
    from.setDate(from.getDate() - 7);
  } else {
    from.setDate(from.getDate() - 30);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function ageDaysFrom(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

export default function Reports() {
  const { storeId } = useActiveStoreId();
  const { stores } = useStoresForUser();
  const { staffMember } = useCurrentStaff(storeId);
  const { settings } = useStoreSettings(storeId);

  const [dateRange, setDateRange] = useState("Today");
  const [view, setView] = useState("store"); // store | all
  const [drill, setDrill] = useState(null); // {title, kind}

  const canCombined = stores.length > 1 && staffMember?.role === "owner";
  const storeIds = useMemo(() => {
    if (view === "all" && canCombined) return stores.map((s) => s.store_id);
    return [storeId];
  }, [view, canCombined, stores, storeId]);

  const { from, to } = useMemo(() => rangeForChip(dateRange), [dateRange]);
  const canReports = can(staffMember, "reports_access");
  const canDrill = can(staffMember, "reports_drilldowns");
  const canFinancial = can(staffMember, "financial_visibility");

  const { data: reportByStore = [], isLoading: reportsLoading, error: reportErr } = useQuery({
    queryKey: ["report", storeIds.join(","), from, to],
    enabled: canReports,
    staleTime: 30_000,
    queryFn: async () => {
      const results = await Promise.all(
        storeIds.map(async (sid) => {
          const res = await base44.functions.invoke("getReportData", { store_id: sid, from, to });
          return { store_id: sid, summary: res?.data?.summary || {}, top_products: res?.data?.top_products || [] };
        })
      );
      return results;
    },
    initialData: [],
  });

  const summary = useMemo(() => {
    const agg = {
      sales_count: 0,
      revenue_centavos: 0,
      due_centavos: 0,
      gross_profit_centavos: 0,
    };
    for (const r of reportByStore) {
      const s = r.summary || {};
      agg.sales_count += Number(s.sales_count || 0);
      agg.revenue_centavos += Number(s.revenue_centavos || 0);
      agg.due_centavos += Number(s.due_centavos || 0);
      agg.gross_profit_centavos += Number(s.gross_profit_centavos || 0);
    }
    return agg;
  }, [reportByStore]);

  const topProducts = useMemo(() => {
    const map = new Map();
    for (const r of reportByStore) {
      for (const p of r.top_products || []) {
        const id = p.product_id;
        const prev = map.get(id) || { qty: 0, revenue_centavos: 0, profit_centavos: 0 };
        map.set(id, {
          qty: prev.qty + Number(p.qty || 0),
          revenue_centavos: prev.revenue_centavos + Number(p.revenue_centavos || 0),
          profit_centavos: prev.profit_centavos + Number(p.profit_centavos || 0),
        });
      }
    }
    return Array.from(map.entries())
      .map(([product_id, v]) => ({ product_id, ...v }))
      .sort((a, b) => b.revenue_centavos - a.revenue_centavos)
      .slice(0, 10);
  }, [reportByStore]);

  const marginPct = summary.revenue_centavos > 0 ? ((summary.gross_profit_centavos / summary.revenue_centavos) * 100).toFixed(1) : "0.0";

  // Inventory
  const invStoreIds = view === "all" && canCombined ? storeIds : [storeId];
  const { data: products = [] } = useQuery({
    queryKey: ["report-products", invStoreIds.join(",")],
    queryFn: async () => {
      const perStore = await Promise.all(
        invStoreIds.map(async (sid) => {
          const rows = await base44.entities.Product.filter({ store_id: sid, product_type: "single", is_active: true });
          return (rows || []).map((p) => ({ ...p, __store_id: sid }));
        })
      );
      return perStore.flat();
    },
    initialData: [],
    staleTime: 30_000,
  });

  const inv = useMemo(() => {
    const defaultThresh = Number(settings?.low_stock_threshold_default || 5);
    const sellable = (products || []).filter((p) => p.is_active && p.product_type === "single");
    const tracked = sellable.filter((p) => p.track_stock);
    const low = tracked.filter((p) => {
      const qty = Number(p.stock_quantity ?? p.stock_qty ?? 0);
      const thresh = Number(p.low_stock_threshold ?? defaultThresh);
      return qty > 0 && qty <= thresh;
    });
    const out = tracked.filter((p) => Number(p.stock_quantity ?? p.stock_qty ?? 0) === 0);
    return { sellableCount: sellable.length, trackedCount: tracked.length, lowCount: low.length, outCount: out.length };
  }, [products, settings]);

  // Due aging buckets
  const dueStoreIds = view === "all" && canCombined ? storeIds : [storeId];
  const { data: customers = [] } = useQuery({
    queryKey: ["report-customers", dueStoreIds.join(",")],
    queryFn: async () => {
      const perStore = await Promise.all(
        dueStoreIds.map(async (sid) => {
          const rows = await base44.entities.Customer.filter({ store_id: sid, is_active: true });
          return (rows || []).map((c) => ({ ...c, __store_id: sid }));
        })
      );
      return perStore.flat();
    },
    initialData: [],
    staleTime: 30_000,
  });

  const dueAging = useMemo(() => {
    const buckets = { "0_7": 0, "8_30": 0, "31_plus": 0 };
    const dueCustomers = (customers || []).filter((c) => Number(c.balance_due_centavos || 0) > 0);
    for (const c of dueCustomers) {
      const age =
        ageDaysFrom(c.last_payment_date) ??
        ageDaysFrom(c.last_transaction_date) ??
        ageDaysFrom(c.updated_date) ??
        ageDaysFrom(c.created_date) ??
        0;
      if (age <= 7) buckets["0_7"] += Number(c.balance_due_centavos || 0);
      else if (age <= 30) buckets["8_30"] += Number(c.balance_due_centavos || 0);
      else buckets["31_plus"] += Number(c.balance_due_centavos || 0);
    }
    return buckets;
  }, [customers]);

  // Cashier performance (requires server sale fields; fetch lazily and gate)
  const { data: cashierPerf = [] } = useQuery({
    queryKey: ["cashier-performance", storeId, from, to],
    enabled: canReports && canFinancial,
    staleTime: 30_000,
    queryFn: async () => {
      const sales = await base44.entities.Sale.filter({ store_id: storeId });
      const inRange = (sales || []).filter((s) => {
        if (s.status !== "completed" && s.status !== "due") return false;
        const t = new Date(s.sale_date || s.created_date || s.created_at).getTime();
        return t >= new Date(from).getTime() && t < new Date(to).getTime();
      });
      const by = new Map();
      for (const s of inRange) {
        const key = s.cashier_email || s.created_by_email || "unknown";
        const prev = by.get(key) || { cashier: key, tx: 0, revenue_centavos: 0 };
        by.set(key, {
          cashier: key,
          tx: prev.tx + 1,
          revenue_centavos: prev.revenue_centavos + Number(s.total_centavos || 0),
        });
      }
      return Array.from(by.values()).sort((a, b) => b.revenue_centavos - a.revenue_centavos);
    },
    initialData: [],
  });

  const avgBasket = summary.sales_count > 0 ? Math.round(summary.revenue_centavos / summary.sales_count) : 0;

  const { data: salesDrill = [] } = useQuery({
    queryKey: ["sales-drill", storeIds.join(","), from, to],
    enabled: canReports && canDrill && drill?.kind === "sales",
    staleTime: 10_000,
    queryFn: async () => {
      const perStore = await Promise.all(
        storeIds.map(async (sid) => {
          const sales = await base44.entities.Sale.filter({ store_id: sid });
          const fromT = new Date(from).getTime();
          const toT = new Date(to).getTime();
          return (sales || [])
            .filter((s) => (s.status === "completed" || s.status === "due") )
            .filter((s) => {
              const t = new Date(s.sale_date || s.created_date || s.created_at).getTime();
              return t >= fromT && t < toT;
            })
            .map((s) => ({
              id: s.id,
              store_id: sid,
              sale_date: s.sale_date || s.created_date || s.created_at,
              total_centavos: Number(s.total_centavos || 0),
              status: s.status,
              cashier_email: s.cashier_email || s.created_by_email || "unknown",
              client_tx_id: s.client_tx_id,
            }));
        })
      );
      return perStore
        .flat()
        .sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime())
        .slice(0, 100);
    },
    initialData: [],
  });

  if (!canReports) {
    const msg = guard(staffMember, "reports_access").reason;
    return (
      <div className="px-4 py-6 pb-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-stone-600">{msg}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 pb-24 space-y-4">
      {/* Store/All toggle */}
      {canCombined && (
        <div className="flex gap-2">
          <button
            onClick={() => setView("store")}
            className={`px-4 py-2 rounded-full text-xs font-semibold border ${
              view === "store" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-stone-600 border-stone-200"
            }`}
          >
            This Store
          </button>
          <button
            onClick={() => setView("all")}
            className={`px-4 py-2 rounded-full text-xs font-semibold border ${
              view === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-stone-600 border-stone-200"
            }`}
          >
            All Stores
          </button>
        </div>
      )}

      {/* Date chips */}
      <div className="flex gap-2">
        {DATE_CHIPS.map((chip) => (
          <button
            key={chip}
            onClick={() => setDateRange(chip)}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all no-select touch-target ${
              dateRange === chip
                ? "bg-blue-600 text-white shadow-md"
                : "bg-white text-stone-600 border border-stone-200"
            }`}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Sales Summary */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />Sales Summary
          </CardTitle>
          <p className="text-[10px] text-stone-400">Total benta sa napiling date range.</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Gross Sales</p>
              {canFinancial ? (
                <CentavosDisplay centavos={summary.revenue_centavos} size="lg" className="text-stone-800" />
              ) : (
                <p className="text-xl font-bold text-stone-400">Hidden</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Transactions</p>
              <p className="text-xl font-bold text-stone-800">{reportsLoading ? "…" : summary.sales_count}</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Avg Basket</p>
              {canFinancial ? (
                <CentavosDisplay centavos={avgBasket} size="md" className="text-stone-600" />
              ) : (
                <p className="text-sm font-semibold text-stone-400">Hidden</p>
              )}
            </div>
          </div>
          {canDrill && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full h-9 text-xs"
              onClick={() => setDrill({ kind: "sales", title: "Sales Drilldown" })}
            >
              View sales drilldown <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Top Products */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />Top Products
          </CardTitle>
          <p className="text-[10px] text-stone-400">Pinakamabilis mabenta.</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {topProducts.length === 0 ? (
            <p className="text-xs text-stone-400 py-2">No sales data yet.</p>
          ) : (
            <div className="space-y-2">
              {topProducts.slice(0, 5).map((p, i) => (
                <div key={p.product_id} className="flex items-center gap-3 py-1.5">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm text-stone-700 flex-1 truncate">{p.product_id}</span>
                  <span className="text-xs text-stone-400">{p.qty} sold</span>
                  {canFinancial && <CentavosDisplay centavos={p.revenue_centavos} size="xs" className="text-stone-600" />}
                </div>
              ))}
            </div>
          )}
          {canDrill && topProducts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full h-9 text-xs"
              onClick={() => setDrill({ kind: "top_products", title: "Top Products" })}
            >
              View product drilldown <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Gross Profit (permission gated) */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-emerald-600" />Gross Profit
          </CardTitle>
          <p className="text-[10px] text-stone-400">Based sa cost snapshot noong binenta.</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {canFinancial ? (
            <div className="flex items-end gap-3">
              <CentavosDisplay centavos={summary.gross_profit_centavos} size="xl" className="text-emerald-700" />
              <span className="text-sm font-medium text-stone-400 mb-0.5">{marginPct}% margin</span>
            </div>
          ) : (
            <p className="text-sm text-stone-500">Hidden (financial visibility required)</p>
          )}
        </CardContent>
      </Card>

      {/* Inventory Health (store-only accurate) */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-stone-600" />Inventory Health
          </CardTitle>
          <p className="text-[10px] text-stone-400">{view === "all" ? "Combined view" : "This store"}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Sellable Items</p>
              <p className="text-xl font-bold text-stone-800">{inv.sellableCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Tracked Items</p>
              <p className="text-xl font-bold text-stone-800">{inv.trackedCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Low Stock</p>
              <p className="text-xl font-bold text-amber-600">{inv.lowCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Out of Stock</p>
              <p className="text-xl font-bold text-red-600">{inv.outCount}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Link to={createPageUrl("Items") + "?filter=low_stock"} className="flex-1">
              <Button variant="outline" className="w-full h-9 text-xs">View Low Stocks</Button>
            </Link>
            <Link to={createPageUrl("Items") + "?filter=out_of_stock"} className="flex-1">
              <Button variant="outline" className="w-full h-9 text-xs">View Out of Stock</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Due aging */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-red-500" />Due Aging
          </CardTitle>
          <p className="text-[10px] text-stone-400">Utang buckets (this store).</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-stone-50 rounded-xl p-3">
              <p className="text-[10px] text-stone-500">0–7 days</p>
              <CentavosDisplay centavos={dueAging["0_7"]} size="sm" className="text-stone-700" />
            </div>
            <div className="bg-stone-50 rounded-xl p-3">
              <p className="text-[10px] text-stone-500">8–30 days</p>
              <CentavosDisplay centavos={dueAging["8_30"]} size="sm" className="text-stone-700" />
            </div>
            <div className="bg-stone-50 rounded-xl p-3">
              <p className="text-[10px] text-stone-500">31+ days</p>
              <CentavosDisplay centavos={dueAging["31_plus"]} size="sm" className="text-stone-700" />
            </div>
          </div>
          <Link to={createPageUrl("CustomersDue")}>
            <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-stone-500 h-8">
              View due customers <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Cashier performance */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="w-4 h-4 text-stone-500" />Cashier Performance
          </CardTitle>
          <p className="text-[10px] text-stone-400">Permission gated (financial visibility).</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {canFinancial ? (
            cashierPerf.length === 0 ? (
              <p className="text-xs text-stone-400 py-2">No sales yet.</p>
            ) : (
              <div className="space-y-2">
                {cashierPerf.slice(0, 5).map((c) => (
                  <div key={c.cashier} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-stone-600 truncate flex-1">{c.cashier}</span>
                    <span className="text-xs text-stone-400 mr-2">{c.tx} tx</span>
                    <CentavosDisplay centavos={c.revenue_centavos} size="xs" className="text-stone-700" />
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="text-sm text-stone-500">Hidden (financial visibility required)</p>
          )}
        </CardContent>
      </Card>

      {/* Combined view breakdown */}
      {view === "all" && canCombined && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">Per-store breakdown</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {reportByStore.map((r) => (
              <div key={r.store_id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                <span className="text-xs text-stone-600">{r.store_id}</span>
                {canFinancial && <CentavosDisplay centavos={Number(r.summary?.revenue_centavos || 0)} size="xs" className="text-stone-800" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Drilldown Sheet */}
      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="bottom" className="p-0 max-h-[85dvh] overflow-y-auto">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>{drill?.title || "Details"}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            {!canDrill ? (
              <p className="text-sm text-stone-600">{guard(staffMember, "reports_drilldowns").reason}</p>
            ) : drill?.kind === "top_products" ? (
              <div className="space-y-2">
                {topProducts.map((p) => (
                  <div key={p.product_id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-700 truncate">{p.product_id}</p>
                      <p className="text-[11px] text-stone-400">{p.qty} sold</p>
                    </div>
                    {canFinancial && <CentavosDisplay centavos={p.revenue_centavos} size="sm" className="text-stone-800" />}
                  </div>
                ))}
              </div>
            ) : drill?.kind === "sales" ? (
              <div className="space-y-2">
                {salesDrill.length === 0 ? (
                  <p className="text-sm text-stone-500">No sales in range.</p>
                ) : (
                  salesDrill.map((s) => (
                    <div key={s.id} className="flex items-start justify-between py-2 border-b border-stone-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-700 truncate">{s.cashier_email}</p>
                        <p className="text-[11px] text-stone-400">
                          {new Date(s.sale_date).toLocaleString("en-PH", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {view === "all" ? ` • ${s.store_id}` : ""}
                        </p>
                        <p className="text-[11px] text-stone-400 truncate">{s.client_tx_id}</p>
                      </div>
                      {canFinancial && <CentavosDisplay centavos={s.total_centavos} size="sm" className="text-stone-800" />}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <p className="text-sm text-stone-500">No drilldown available.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
