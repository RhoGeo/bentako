import React, { useMemo } from "react";
import { ArrowLeft, Layers, RefreshCw, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useStoresForUser } from "@/components/lib/useStores";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function CombinedView() {
  const navigate = useNavigate();
  const { stores, isLoading: storesLoading, user } = useStoresForUser({ includeArchived: true });

  const { data: myMemberships = [] } = useQuery({
    queryKey: ["my-memberships", user?.email],
    enabled: !!user?.email,
    queryFn: () => base44.entities.StaffMember.filter({ user_email: user.email, is_active: true }),
    initialData: [],
    staleTime: 60_000,
  });

  const ownerStoreIds = new Set(myMemberships.filter((m) => m.role === "owner").map((m) => m.store_id));
  const ownerStores = (stores || []).filter((s) => ownerStoreIds.has(s.store_id));

  const reportQueries = useQueries({
    queries: ownerStores.map((s) => ({
      queryKey: ["report-data", s.store_id, "today"],
      queryFn: async () => {
        const res = await base44.functions.invoke("getReportData", { store_id: s.store_id, period: "today" });
        return { store: s, data: res?.data?.data || res?.data };
      },
      enabled: navigator.onLine,
      staleTime: 60_000,
    })),
  });

  const reports = reportQueries.map((q) => q.data).filter(Boolean);

  const totals = useMemo(() => {
    let gross = 0;
    let txCount = 0;
    for (const r of reports) {
      gross += Number(r?.data?.gross_sales_cents || 0);
      txCount += Number(r?.data?.transactions_count || 0);
    }
    return { gross, txCount };
  }, [reports]);

  const storeIds = ownerStores.map((s) => s.store_id);

  const { data: events = [], refetch: refetchEvents, isFetching: eventsFetching } = useQuery({
    queryKey: ["combined-events", storeIds.join(",")],
    enabled: navigator.onLine && storeIds.length > 0,
    queryFn: async () => {
      const rows = await base44.entities.ActivityEvent.list("-created_date", 50);
      return (rows || []).filter((e) => storeIds.includes(e.store_id));
    },
    initialData: [],
    staleTime: 30_000,
  });

  const anyLoading = storesLoading || reportQueries.some((q) => q.isLoading);

  return (
    <div className="pb-24 px-4 pt-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="touch-target">
          <ArrowLeft className="w-5 h-5 text-stone-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-stone-800">Owner Combined View</h1>
          <p className="text-xs text-stone-500">Across your owned stores</p>
        </div>
        <Button variant="outline" className="h-9" onClick={() => { reportQueries.forEach((q) => q.refetch?.()); refetchEvents(); }}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {anyLoading ? (
        <div className="text-sm text-stone-400 text-center py-10">Loading…</div>
      ) : ownerStores.length === 0 ? (
        <div className="text-sm text-stone-400 text-center py-10">No owner stores.</div>
      ) : (
        <div className="space-y-4">
          <Card className="border-stone-100 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Today Totals</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-500">Gross Sales</p>
                <p className="text-xl font-bold text-stone-800"><CentavosDisplay centavos={totals.gross} /></p>
              </div>
              <div className="text-right">
                <p className="text-xs text-stone-500">Transactions</p>
                <p className="text-xl font-bold text-stone-800">{totals.txCount}</p>
              </div>
            </CardContent>
          </Card>

          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Per-store breakdown</p>
            <div className="space-y-2">
              {ownerStores.map((s, idx) => {
                const rq = reportQueries[idx];
                const data = rq?.data?.data;
                return (
                  <div key={s.store_id} className="bg-white rounded-xl border border-stone-100 p-4">
                    <p className="text-sm font-semibold text-stone-800">{s.store_name || s.store_id}</p>
                    <p className="text-[11px] text-stone-400 mb-2">{s.store_id}</p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] text-stone-500">Gross</p>
                        <p className="text-sm font-bold text-stone-800"><CentavosDisplay centavos={Number(data?.gross_sales_cents || 0)} /></p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-stone-500">Transactions</p>
                        <p className="text-sm font-bold text-stone-800">{Number(data?.transactions_count || 0)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              Recent activity <Clock className="w-3.5 h-3.5" />
            </p>
            <div className="bg-white rounded-xl border border-stone-100 overflow-hidden">
              {eventsFetching ? (
                <div className="px-4 py-6 text-sm text-stone-400">Loading…</div>
              ) : events.length === 0 ? (
                <div className="px-4 py-6 text-sm text-stone-400">No recent events.</div>
              ) : (
                events.map((e, idx) => (
                  <div key={e.id} className={`px-4 py-3 ${idx < events.length - 1 ? "border-b border-stone-50" : ""}`}>
                    <p className="text-sm font-medium text-stone-800">{e.event_type}</p>
                    <p className="text-[11px] text-stone-400">{e.store_id} · {new Date(e.created_at || e.created_date).toLocaleString("en-PH")}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
