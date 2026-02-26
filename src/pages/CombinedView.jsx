import React, { useMemo, useState } from "react";
import { Layers, RefreshCw, Clock } from "lucide-react";
// no routing needed here; SubpageHeader handles back navigation
import SubpageHeader from "@/components/layout/SubpageHeader";
import { useQuery } from "@tanstack/react-query";
import { invokeFunction } from "@/api/posyncClient";
import { useStoresForUser } from "@/components/lib/useStores";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

export default function CombinedView() {
  const { stores, memberships, isLoading } = useStoresForUser();
  const [dateRange, setDateRange] = useState("Today");

  const ownerStoreIds = useMemo(() => {
    const ms = memberships || [];
    const list = (stores || [])
      .map((s) => ({
        store_id: s.id || s.store_id,
        store_name: s.store_name || s.name,
        role: (ms.find((m) => m.store_id === (s.id || s.store_id))?.role || "").toLowerCase(),
      }))
      .filter((x) => x.store_id && x.role === "owner");
    return list;
  }, [stores, memberships]);

  const { from, to } = useMemo(() => rangeForChip(dateRange), [dateRange]);

  const storeIds = ownerStoreIds.map((s) => s.store_id);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["combined-view", storeIds.join(","), from, to],
    enabled: navigator.onLine && storeIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await invokeFunction("getCombinedViewData", { store_ids: storeIds, from, to });
      return res?.data?.data || res?.data || res;
    },
    initialData: null,
  });

  const totals = data?.data?.totals || data?.totals || { revenue_centavos: 0, sales_count: 0, due_centavos: 0 };
  const per_store = data?.data?.per_store || data?.per_store || [];
  const events = data?.data?.recent_activity || data?.recent_activity || [];

  const anyLoading = isLoading || isFetching;

  return (
    <div className="pb-24">
      <SubpageHeader
        title="Owner Combined View"
        subtitle="Read-only analytics across stores"
        right={
          <Button
            variant="outline"
            className="h-9 bg-white/10 text-white border-white/20 hover:bg-white/15"
            onClick={() => refetch()}
            disabled={!navigator.onLine || anyLoading}
          >
            <RefreshCw className={`w-4 h-4 ${anyLoading ? "animate-spin" : ""}`} />
          </Button>
        }
      />

      {!navigator.onLine && (
        <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
          Offline — Combined View requires internet.
        </div>
      )}

      <div className="px-4 py-4 flex gap-2">
        {DATE_CHIPS.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={dateRange === c ? "default" : "outline"}
            className="h-9"
            onClick={() => setDateRange(c)}
          >
            {c}
          </Button>
        ))}
      </div>

      <div className="px-4 py-1 space-y-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />{dateRange} (All Owner Stores)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-stone-50 rounded-lg py-2">
                <p className="text-[10px] text-stone-400 uppercase">Sales</p>
                <CentavosDisplay centavos={Number(totals.revenue_centavos || 0)} size="sm" className="text-stone-700" />
              </div>
              <div className="bg-stone-50 rounded-lg py-2">
                <p className="text-[10px] text-stone-400 uppercase">Tx</p>
                <p className="text-lg font-bold text-stone-800">{Number(totals.sales_count || 0)}</p>
              </div>
              <div className="bg-stone-50 rounded-lg py-2">
                <p className="text-[10px] text-stone-400 uppercase">Due</p>
                <CentavosDisplay centavos={Number(totals.due_centavos || 0)} size="sm" className="text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div>
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Per-store breakdown</p>
          <div className="space-y-2">
            {(per_store || []).map((r) => (
              <div key={r.store_id} className="bg-white rounded-xl border border-stone-100 p-4">
                <p className="text-sm font-semibold text-stone-800">{r.store_name || r.store_id}</p>
                <p className="text-[11px] text-stone-400 mb-2">{r.store_id}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-stone-50 rounded-lg py-2">
                    <p className="text-[10px] text-stone-400">Sales</p>
                    <CentavosDisplay centavos={Number(r.revenue_centavos || 0)} size="xs" className="text-stone-700" />
                  </div>
                  <div className="bg-stone-50 rounded-lg py-2">
                    <p className="text-[10px] text-stone-400">Tx</p>
                    <p className="text-sm font-bold text-stone-800">{Number(r.sales_count || 0)}</p>
                  </div>
                  <div className="bg-stone-50 rounded-lg py-2">
                    <p className="text-[10px] text-stone-400">Due</p>
                    <CentavosDisplay centavos={Number(r.due_centavos || 0)} size="xs" className="text-red-700" />
                  </div>
                </div>
              </div>
            ))}

            {!navigator.onLine && (
              <div className="text-xs text-stone-500">Connect to internet to load combined metrics.</div>
            )}

            {navigator.onLine && storeIds.length === 0 && (
              <div className="text-xs text-stone-500">No owner stores found.</div>
            )}
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
                {events.slice(0, 18).map((ev) => (
                  <div key={ev.activity_id || ev.id} className="flex items-start gap-2 py-1.5 border-b border-stone-50 last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-stone-300 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-stone-600 leading-tight">{ev.description || ev.event_type}</p>
                      <p className="text-[10px] text-stone-400 mt-0.5">
                        {ev.store_id} · {ev.created_at ? new Date(ev.created_at).toLocaleString("en-PH") : ""}
                      </p>
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
