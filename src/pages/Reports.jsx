import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import {
  TrendingUp,
  ShoppingBag,
  Package,
  Users,
  BarChart3,
  ArrowRight,
  User,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoresForUser } from "@/components/lib/useStores";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can, guard } from "@/components/lib/permissions";
import { invokeFunction } from "@/api/posyncClient";

const DATE_CHIPS = ["Today", "Week", "Month"];

function rangeForChip(chip) {
  const now = new Date();
  const to = new Date(now.getTime() + 60 * 60 * 1000);
  const from = new Date(now);
  if (chip === "Today") from.setHours(0, 0, 0, 0);
  else if (chip === "Week") from.setDate(from.getDate() - 7);
  else from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function Reports() {
  const { storeId } = useActiveStoreId();
  const { stores } = useStoresForUser();
  const { staffMember } = useCurrentStaff(storeId);

  const [dateRange, setDateRange] = useState("Today");
  const [view, setView] = useState("store"); // store | all
  const [drill, setDrill] = useState(null); // {title, kind}

  const canReports = can(staffMember, "reports_access");
  const canDrill = can(staffMember, "reports_drilldowns");
  const canFinancial = can(staffMember, "financial_visibility");

  const canCombined = (stores || []).length > 1 && String(staffMember?.role || "").toLowerCase() === "owner";

  const storeIds = useMemo(() => {
    if (view === "all" && canCombined) return (stores || []).map((s) => s.id || s.store_id).filter(Boolean);
    return [storeId].filter(Boolean);
  }, [view, canCombined, stores, storeId]);

  const { from, to } = useMemo(() => rangeForChip(dateRange), [dateRange]);

  const { data: report, isLoading: reportsLoading } = useQuery({
    queryKey: ["report-bundle", storeIds.join(","), from, to],
    enabled: canReports && storeIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const payload = storeIds.length === 1
        ? { store_id: storeIds[0], from, to }
        : { store_ids: storeIds, from, to };
      const res = await invokeFunction("getReportData", payload);
      return res?.data?.data || res?.data || res;
    },
    initialData: null,
  });

  const { data: drillData } = useQuery({
    queryKey: ["report-drill", storeIds.join(","), from, to, drill?.kind],
    enabled: canReports && canDrill && !!drill && storeIds.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const payload = storeIds.length === 1
        ? { store_id: storeIds[0], from, to, include_drilldowns: true }
        : { store_ids: storeIds, from, to, include_drilldowns: true };
      const res = await invokeFunction("getReportData", payload);
      return res?.data?.data || res?.data || res;
    },
    initialData: null,
  });

  const summary = report?.data?.summary || report?.summary || {};
  const topProducts = report?.data?.top_products || report?.top_products || [];
  const inventory = report?.data?.inventory || report?.inventory || {};
  const due = report?.data?.due_aging || report?.due_aging || {};
  const perStore = report?.data?.per_store || report?.per_store || [];

  const avgBasket = Number(summary.avg_basket_centavos || 0);
  const marginPct = Number(summary.revenue_centavos || 0) > 0
    ? ((Number(summary.gross_profit_centavos || 0) / Number(summary.revenue_centavos || 0)) * 100).toFixed(1)
    : "0.0";

  const salesRecentByStore = drillData?.data?.drilldowns?.per_store_sales_recent || drillData?.drilldowns?.per_store_sales_recent || [];
  const salesDrill = useMemo(() => {
    if (!drill || drill.kind !== "sales") return [];
    const flat = [];
    for (const s of salesRecentByStore || []) {
      for (const row of s.sales_recent || []) {
        flat.push({ ...row, store_id: s.store_id });
      }
    }
    return flat.sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime());
  }, [drill, salesRecentByStore]);

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
      {/* Header controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {DATE_CHIPS.map((chip) => (
            <Button
              key={chip}
              size="sm"
              variant={dateRange === chip ? "default" : "outline"}
              className="h-9"
              onClick={() => setDateRange(chip)}
            >
              {chip}
            </Button>
          ))}
        </div>
        {canCombined && (
          <Button
            size="sm"
            variant={view === "all" ? "default" : "outline"}
            className="h-9"
            onClick={() => setView(view === "all" ? "store" : "all")}
          >
            <Layers className="w-4 h-4 mr-2" /> {view === "all" ? "All Stores" : "This Store"}
          </Button>
        )}
      </div>

      {/* Sales summary */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-600" />Sales Summary
          </CardTitle>
          <p className="text-[10px] text-stone-400">{dateRange} • {view === "all" ? "Combined" : "This store"}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Gross Sales</p>
              {canFinancial ? (
                <CentavosDisplay centavos={Number(summary.revenue_centavos || 0)} size="lg" className="text-stone-800" />
              ) : (
                <p className="text-xl font-bold text-stone-400">Hidden</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Transactions</p>
              <p className="text-xl font-bold text-stone-800">{reportsLoading ? "…" : Number(summary.sales_count || 0)}</p>
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
                  <span className="text-sm text-stone-700 flex-1 truncate">{p.product_name || p.product_id}</span>
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

      {/* Gross Profit */}
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
              <CentavosDisplay centavos={Number(summary.gross_profit_centavos || 0)} size="xl" className="text-emerald-700" />
              <span className="text-sm font-medium text-stone-400 mb-0.5">{marginPct}% margin</span>
            </div>
          ) : (
            <p className="text-sm text-stone-500">Hidden (financial visibility required)</p>
          )}
        </CardContent>
      </Card>

      {/* Inventory */}
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
              <p className="text-xl font-bold text-stone-800">{Number(inventory.sellable_count || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Tracked Items</p>
              <p className="text-xl font-bold text-stone-800">{Number(inventory.tracked_count || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Low Stock</p>
              <p className="text-xl font-bold text-amber-600">{Number(inventory.low_stock_count || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 uppercase">Out of Stock</p>
              <p className="text-xl font-bold text-red-600">{Number(inventory.out_of_stock_count || 0)}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => setDrill({ kind: "low_stock", title: "Low Stock Items" })} disabled={!canDrill}>
              View Low Stocks
            </Button>
            <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => setDrill({ kind: "out_of_stock", title: "Out of Stock Items" })} disabled={!canDrill}>
              View Out of Stock
            </Button>
          </div>
          {!canDrill && <p className="text-[11px] text-stone-400 mt-2">{guard(staffMember, "reports_drilldowns").reason}</p>}
        </CardContent>
      </Card>

      {/* Due aging */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-red-500" />Due Aging
          </CardTitle>
          <p className="text-[10px] text-stone-400">Utang buckets</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: "0_7", label: "0–7" },
              { k: "8_30", label: "8–30" },
              { k: "31_plus", label: "31+" },
            ].map((b) => (
              <button
                key={b.k}
                className="bg-stone-50 rounded-xl p-3 text-left"
                onClick={() => canDrill && setDrill({ kind: "due_customers", title: `Due Customers (${b.label} days)`, bucket: b.k })}
                disabled={!canDrill}
              >
                <p className="text-[10px] text-stone-500">{b.label} days</p>
                <CentavosDisplay centavos={Number(due?.buckets_centavos?.[b.k] || 0)} size="sm" className="text-stone-700" />
              </button>
            ))}
          </div>
          <Link to={createPageUrl("CustomersDue")}>
            <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-stone-500 h-8">
              Open Due Customers screen <ArrowRight className="w-3 h-3 ml-1" />
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
          <p className="text-[10px] text-stone-400">Permission gated (financial visibility)</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {canFinancial ? (
            storeIds.length > 1 ? (
              <p className="text-xs text-stone-400">Select a store to view cashier performance.</p>
            ) : (
              (report?.data?.cashier_performance || report?.cashier_performance || []).length === 0 ? (
                <p className="text-xs text-stone-400 py-2">No sales yet.</p>
              ) : (
                <div className="space-y-2">
                  {(report?.data?.cashier_performance || report?.cashier_performance || []).slice(0, 5).map((c) => (
                    <div key={c.cashier} className="flex items-center justify-between py-1.5">
                      <span className="text-xs text-stone-600 truncate flex-1">{c.cashier}</span>
                      <span className="text-xs text-stone-400 mr-2">{c.tx} tx</span>
                      <CentavosDisplay centavos={c.revenue_centavos} size="xs" className="text-stone-700" />
                    </div>
                  ))}
                </div>
              )
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
            {perStore.map((r) => (
              <div key={r.store_id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                <span className="text-xs text-stone-600">{r.store_name || r.store_id}</span>
                {canFinancial && <CentavosDisplay centavos={Number(r.revenue_centavos || 0)} size="xs" className="text-stone-800" />}
              </div>
            ))}
            <Link to={createPageUrl("CombinedView")}>
              <Button variant="outline" className="w-full h-10 text-xs mt-2">
                Open Owner Combined View <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
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
                      <p className="text-sm font-medium text-stone-700 truncate">{p.product_name || p.product_id}</p>
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
                    <div key={s.sale_id} className="flex items-start justify-between py-2 border-b border-stone-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-700 truncate">{s.cashier_email}</p>
                        <p className="text-[11px] text-stone-400">
                          {new Date(s.sale_date).toLocaleString("en-PH", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {view === "all" ? ` • ${s.store_id}` : ""}
                        </p>
                        <p className="text-[11px] text-stone-400 truncate">{s.receipt_number || s.client_tx_id}</p>
                      </div>
                      {canFinancial && <CentavosDisplay centavos={s.total_centavos} size="sm" className="text-stone-800" />}
                    </div>
                  ))
                )}
              </div>
            ) : drill?.kind === "low_stock" ? (
              <div className="space-y-2">
                {(inventory.low_stock || []).length === 0 ? (
                  <p className="text-sm text-stone-500">No low stock items.</p>
                ) : (
                  (inventory.low_stock || []).map((p) => (
                    <div key={`${p.store_id || ""}-${p.product_id}`} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-700 truncate">{p.name || p.product_id}</p>
                        <p className="text-[11px] text-stone-400">qty {p.stock_quantity} • threshold {p.threshold}{view === "all" ? ` • ${p.store_id}` : ""}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : drill?.kind === "out_of_stock" ? (
              <div className="space-y-2">
                {(inventory.out_of_stock || []).length === 0 ? (
                  <p className="text-sm text-stone-500">No out-of-stock items.</p>
                ) : (
                  (inventory.out_of_stock || []).map((p) => (
                    <div key={`${p.store_id || ""}-${p.product_id}`} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-700 truncate">{p.name || p.product_id}</p>
                        <p className="text-[11px] text-stone-400">qty 0{view === "all" ? ` • ${p.store_id}` : ""}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : drill?.kind === "due_customers" ? (
              <div className="space-y-2">
                {(due.due_customers || [])
                  .filter((c) => !drill.bucket || c.bucket === drill.bucket)
                  .slice(0, 200)
                  .map((c) => (
                    <div key={`${c.store_id || ""}-${c.customer_id}`} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-700 truncate">{c.name || c.customer_id}</p>
                        <p className="text-[11px] text-stone-400">{c.age_days} days • {c.bucket}{view === "all" ? ` • ${c.store_id}` : ""}</p>
                      </div>
                      {canFinancial && <CentavosDisplay centavos={c.balance_due_centavos} size="sm" className="text-red-700" />}
                    </div>
                  ))}
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
