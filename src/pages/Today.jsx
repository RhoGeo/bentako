import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import {
  TrendingUp,
  ShoppingBag,
  AlertTriangle,
  Users,
  RefreshCw,
  Clock,
  ArrowRight,
  AlertOctagon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoresForUser } from "@/components/lib/useStores";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { getOfflineQueueCounts } from "@/components/lib/db";
import { can } from "@/components/lib/permissions";

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function Today() {
  const { storeId } = useActiveStoreId();
  const { stores } = useStoresForUser();
  const { staffMember } = useCurrentStaff(storeId);
  const { settings } = useStoreSettings(storeId);

  const canCombined = stores.length > 1 && (staffMember?.role === "owner" || staffMember?.role === "manager");
  const [view, setView] = useState("store"); // store | all

  const activeStoreIds = useMemo(() => {
    if (view === "all" && canCombined) return stores.map((s) => s.store_id);
    return [storeId];
  }, [view, canCombined, stores, storeId]);

  const from = startOfTodayISO();
  const to = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(); // small future buffer

  const { data: summaries = [], isLoading: summaryLoading } = useQuery({
    queryKey: ["today-summaries", activeStoreIds.join(","), from],
    enabled: can(staffMember, "reports_access"),
    queryFn: async () => {
      const results = await Promise.all(
        activeStoreIds.map(async (sid) => {
          const res = await base44.functions.invoke("getReportData", { store_id: sid, from, to });
          return { store_id: sid, ...(res?.data?.summary || {}) };
        })
      );
      return results;
    },
    initialData: [],
    staleTime: 15_000,
  });

  const todayTotal = summaries.reduce((s, r) => s + Number(r.revenue_centavos || 0), 0);
  const todayCount = summaries.reduce((s, r) => s + Number(r.sales_count || 0), 0);

  const { data: queueCounts } = useQuery({
    queryKey: ["offline-queue-counts", storeId],
    queryFn: () => getOfflineQueueCounts(storeId),
    refetchInterval: 4_000,
    initialData: { queued: 0, pushing: 0, failed_permanent: 0, total: 0 },
  });

  const hasStopTheLine = (queueCounts?.failed_permanent || 0) > 0;
  const queued = (queueCounts?.queued || 0) + (queueCounts?.pushing || 0);

  const { data: products = [] } = useQuery({
    queryKey: ["today-products", storeId],
    queryFn: () => base44.entities.Product.filter({ store_id: storeId, product_type: "single", is_active: true }),
    initialData: [],
    staleTime: 30_000,
  });

  const lowStockItems = useMemo(() => {
    const defaultThresh = Number(settings?.low_stock_threshold_default || 5);
    return (products || [])
      .filter((p) => p.track_stock)
      .filter((p) => {
        const qty = Number(p.stock_quantity ?? p.stock_qty ?? 0);
        const thresh = Number(p.low_stock_threshold ?? defaultThresh);
        return qty > 0 && qty <= thresh;
      })
      .sort((a, b) => (Number(a.stock_quantity ?? a.stock_qty ?? 0) - Number(b.stock_quantity ?? b.stock_qty ?? 0)))
      .slice(0, 5);
  }, [products, settings]);

  const { data: customers = [] } = useQuery({
    queryKey: ["today-customers", storeId],
    queryFn: () => base44.entities.Customer.filter({ store_id: storeId, is_active: true }),
    initialData: [],
    staleTime: 30_000,
  });

  const dueCustomers = useMemo(() => {
    return (customers || [])
      .filter((c) => Number(c.balance_due_centavos || 0) > 0)
      .sort((a, b) => Number(b.balance_due_centavos || 0) - Number(a.balance_due_centavos || 0))
      .slice(0, 5);
  }, [customers]);

  const { data: activity = [] } = useQuery({
    queryKey: ["today-activity", activeStoreIds.join(",")],
    queryFn: async () => {
      const perStore = await Promise.all(
        activeStoreIds.map(async (sid) => {
          const rows = await base44.entities.ActivityEvent.list("-created_date", 20);
          // ActivityEvent is store-scoped in data; still filter defensively.
          return (rows || []).filter((r) => r.store_id === sid);
        })
      );
      return perStore.flat().sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()).slice(0, 10);
    },
    initialData: [],
    staleTime: 15_000,
  });

  return (
    <div className="px-4 py-5 pb-24 space-y-4">
      {/* Combined view toggle */}
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

      {/* Stop-the-line alert */}
      {hasStopTheLine && (
        <Link to={createPageUrl("SyncStatus")}>
          <div className="bg-red-600 rounded-xl p-4 flex items-start gap-3">
            <AlertOctagon className="w-5 h-5 text-white flex-shrink-0 mt-0.5 animate-pulse" />
            <div>
              <p className="text-white font-bold text-sm">IMMEDIATE ATTENTION NEEDED</p>
              <p className="text-red-200 text-xs mt-0.5">
                {queueCounts?.failed_permanent || 0} event(s) failed permanently — kailangan ayusin ngayon. Tap to view.
              </p>
            </div>
          </div>
        </Link>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl p-4 border border-stone-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Sales</span>
          </div>
          <CentavosDisplay centavos={todayTotal} size="xl" className="text-stone-800" />
          <p className="text-[11px] text-stone-400 mt-1">Ngayong araw</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-stone-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Transactions</span>
          </div>
          <p className="text-2xl font-bold text-stone-800">{summaryLoading ? "…" : todayCount}</p>
          <p className="text-[11px] text-stone-400 mt-1">Ngayong araw</p>
        </div>
      </div>

      {/* Sync Queue card */}
      {queued > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-amber-600" />Queued Events ({queued})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xs text-stone-500 mb-3">Mga sale at events na hindi pa na-sync sa server.</p>
            <Link to={createPageUrl("SyncStatus")}>
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white h-9 touch-target">
                <RefreshCw className="w-3 h-3 mr-1.5" />View Sync Status
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Low Stock */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />Low Stock
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {lowStockItems.length === 0 ? (
            <p className="text-xs text-stone-400 py-2">Walang low stock items.</p>
          ) : (
            <div className="space-y-2">
              {lowStockItems.map((item) => {
                const qty = Number(item.stock_quantity ?? item.stock_qty ?? 0);
                return (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                    <span className="text-sm font-medium text-stone-700 truncate flex-1">{item.name}</span>
                    <span className="text-sm font-bold text-amber-600 ml-2">{qty} left</span>
                  </div>
                );
              })}
            </div>
          )}
          <Link to={createPageUrl("Items") + "?filter=low_stock"}>
            <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-stone-500 h-8">
              View Low Stocks <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Due Reminders */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-red-500" />Utang Reminders
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {dueCustomers.length === 0 ? (
            <p className="text-xs text-stone-400 py-2">Walang utang.</p>
          ) : (
            <div className="space-y-2">
              {dueCustomers.map((cust) => (
                <div key={cust.id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                  <span className="text-sm font-medium text-stone-700 truncate flex-1">{cust.name}</span>
                  <CentavosDisplay centavos={cust.balance_due_centavos} size="sm" className="text-red-600" />
                </div>
              ))}
            </div>
          )}
          <Link to={createPageUrl("CustomersDue")}>
            <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-stone-500 h-8">
              View All Customers <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Activity Feed */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-stone-400" />Activity Feed
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {activity.length === 0 ? (
            <p className="text-xs text-stone-400 py-2">No recent activity.</p>
          ) : (
            <div className="space-y-2">
              {activity.slice(0, 10).map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 py-1.5 border-b border-stone-50 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-stone-300 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-stone-600 leading-tight">{ev.description}</p>
                    <p className="text-[10px] text-stone-400 mt-0.5">
                      {new Date(ev.created_date).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
                      {view === "all" && ev.store_id ? ` • ${ev.store_id}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
