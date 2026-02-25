import React, { useMemo } from "react";
import { ArrowLeft, Layers, RefreshCw, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useMyStores } from "@/components/lib/storeScope";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function CombinedView() {
  const navigate = useNavigate();
  const storesQ = useMyStores();
  const stores = (storesQ.data || []).filter((s) => String(s.membership?.role || "").toLowerCase() === "owner");

  const reportQueries = useQueries({
    queries: stores.map((s) => ({
      queryKey: ["report-data", s.id, "today"],
      queryFn: async () => {
        const res = await base44.functions.invoke("getReportData", { store_id: s.id, period: "today" });
        return { store: s, data: res?.data?.data };
      },
      enabled: navigator.onLine,
      staleTime: 60_000,
    })),
  });

  const reports = reportQueries.map((q) => q.data).filter(Boolean);
  const totals = useMemo(() => {
    let gross = 0;
    let tx = 0;
    let due = 0;
    for (const r of reports) {
      gross += Number(r.data?.sales_summary?.gross_sales_centavos || 0);
      tx += Number(r.data?.sales_summary?.tx_count || 0);
      const aging = r.data?.due_aging_centavos || {};
      due += Number(aging["0_7"] || 0) + Number(aging["8_30"] || 0) + Number(aging["31_plus"] || 0);
    }
    return { gross, tx, due };
  }, [reports]);

  const storeIds = stores.map((s) => s.id);
  const { data: events = [] } = useQuery({
    queryKey: ["combined-events", storeIds.join(",")],
    enabled: navigator.onLine && storeIds.length > 0,
    queryFn: async () => {
      const rows = await base44.entities.ActivityEvent.list("-created_date", 50);
      return (rows || []).filter((e) => storeIds.includes(e.store_id));
    },
    initialData: [],
    staleTime: 30_000,
  });

  const anyLoading = storesQ.isLoading || reportQueries.some((q) => q.isLoading);

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">Combined View</h1>
        <Button variant="outline" className="h-9" onClick={() => reportQueries.forEach((q) => q.refetch?.())} disabled={!navigator.onLine || anyLoading}>
          <RefreshCw className={`w-4 h-4 ${anyLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {!navigator.onLine && (
        <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
          Offline — Combined View requires internet.
        </div>
      )}

      <div className="px-4 py-5 space-y-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />Today (All Stores)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-stone-50 rounded-lg py-2">
                <p className="text-[10px] text-stone-400 uppercase">Sales</p>
                <CentavosDisplay centavos={totals.gross} size="sm" className="text-stone-700" />
              </div>
              <div className="bg-stone-50 rounded-lg py-2">
                <p className="text-[10px] text-stone-400 uppercase">Tx</p>
                <p className="text-lg font-bold text-stone-800">{totals.tx}</p>
              </div>
              <div className="bg-stone-50 rounded-lg py-2">
                <p className="text-[10px] text-stone-400 uppercase">Due</p>
                <CentavosDisplay centavos={totals.due} size="sm" className="text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div>
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Per-store breakdown</p>
          <div className="space-y-2">
            {stores.map((s, idx) => {
              const rq = reportQueries[idx];
              const data = rq?.data?.data;
              return (
                <div key={s.id} className="bg-white rounded-xl border border-stone-100 p-4">
                  <p className="text-sm font-semibold text-stone-800">{s.store_name || s.name || s.id}</p>
                  <p className="text-[11px] text-stone-400 mb-2">{s.id}</p>
                  {rq?.isLoading ? (
                    <p className="text-xs text-stone-400">Loading…</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-stone-50 rounded-lg py-2">
                        <p className="text-[10px] text-stone-400">Sales</p>
                        <CentavosDisplay centavos={data?.sales_summary?.gross_sales_centavos || 0} size="xs" className="text-stone-700" />
                      </div>
                      <div className="bg-stone-50 rounded-lg py-2">
                        <p className="text-[10px] text-stone-400">Tx</p>
                        <p className="text-sm font-bold text-stone-800">{data?.sales_summary?.tx_count || 0}</p>
                      </div>
                      <div className="bg-stone-50 rounded-lg py-2">
                        <p className="text-[10px] text-stone-400">Low</p>
                        <p className="text-sm font-bold text-amber-700">{(data?.inventory?.low_stock || []).length}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-stone-500" />Live Feed
            </CardTitle>
            <p className="text-[10px] text-stone-400">Recent activity across stores (read-only)</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {events.length === 0 ? (
              <p className="text-xs text-stone-400">No recent activity.</p>
            ) : (
              <div className="space-y-2">
                {events.slice(0, 12).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-2 py-1.5 border-b border-stone-50 last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-stone-300 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-stone-600 leading-tight">{ev.description || ev.event_type}</p>
                      <p className="text-[10px] text-stone-400 mt-0.5">{ev.store_id} · {new Date(ev.created_at || ev.created_date).toLocaleString("en-PH")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
