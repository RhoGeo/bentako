import React, { useMemo, useState } from "react";
// no routing needed here; SubpageHeader handles back navigation
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Clock, RefreshCw, Trash2 } from "lucide-react";

import SubpageHeader from "@/components/layout/SubpageHeader";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useOfflineSync } from "@/hooks/useOfflineSync";

import {
  listOfflineQueue,
  updateQueueEventStatus,
  getOfflineQueueCounts,
  listSalesByStatus,
  markSalesStatus,
  deletePendingSales,
} from "@/lib/db";

import { syncNow } from "@/components/lib/syncManager";

const EVENT_STATUS_LABEL = {
  queued: { label: "Queued", tone: "amber" },
  pushing: { label: "Sending", tone: "blue" },
  applied: { label: "Applied", tone: "emerald" },
  duplicate_ignored: { label: "Duplicate", tone: "stone" },
  failed_retry: { label: "Failed (retry)", tone: "orange" },
  failed_permanent: { label: "Failed (permanent)", tone: "red" },
};

function Badge({ tone = "stone", children }) {
  const tones = {
    stone: "bg-stone-100 text-stone-600",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    orange: "bg-orange-50 text-orange-700",
    red: "bg-red-50 text-red-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${tones[tone] || tones.stone}`}>{children}</span>;
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-stone-800">{title}</div>
        {subtitle ? <div className="text-xs text-stone-500 mt-0.5">{subtitle}</div> : null}
      </div>
      {right}
    </div>
  );
}

export default function SyncStatus() {
  const qc = useQueryClient();
  const { storeId } = useActiveStoreId();
  const salesSync = useOfflineSync({ storeId });

  const [isSyncingEvents, setIsSyncingEvents] = useState(false);

  const { data: eventCounts } = useQuery({
    queryKey: ["offline-queue-counts", storeId],
    queryFn: () => getOfflineQueueCounts(storeId),
    refetchInterval: 4_000,
    initialData: { queued: 0, pushing: 0, failed_permanent: 0, total: 0 },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["offline-queue", storeId],
    queryFn: () => listOfflineQueue(storeId),
    refetchInterval: 3_000,
    initialData: [],
  });

  const { data: pendingSales = [] } = useQuery({
    queryKey: ["pending-sales", storeId],
    queryFn: () => listSalesByStatus(storeId, "pending"),
    refetchInterval: 3_000,
    initialData: [],
  });

  const { data: failedSales = [] } = useQuery({
    queryKey: ["failed-sales", storeId],
    queryFn: () => listSalesByStatus(storeId, "failed"),
    refetchInterval: 3_000,
    initialData: [],
  });

  const groups = useMemo(() => {
    const by = {
      queued: [],
      pushing: [],
      failed_retry: [],
      failed_permanent: [],
      done: [],
    };
    for (const ev of events) {
      if (ev.status === "queued") by.queued.push(ev);
      else if (ev.status === "pushing") by.pushing.push(ev);
      else if (ev.status === "failed_retry") by.failed_retry.push(ev);
      else if (ev.status === "failed_permanent") by.failed_permanent.push(ev);
      else by.done.push(ev);
    }
    return by;
  }, [events]);

  const criticalCount = groups.failed_permanent.length + failedSales.length;

  const runSyncAll = async () => {
    if (!navigator.onLine) {
      toast.error("Offline — connect to sync.");
      return;
    }
    setIsSyncingEvents(true);
    try {
      await Promise.allSettled([syncNow(storeId), salesSync.syncSales()]);
      toast.success("Sync completed.");
      qc.invalidateQueries({ queryKey: ["offline-queue", storeId] });
      qc.invalidateQueries({ queryKey: ["pending-sales", storeId] });
      qc.invalidateQueries({ queryKey: ["failed-sales", storeId] });
    } finally {
      setIsSyncingEvents(false);
    }
  };

  const retryEvent = async (ev) => {
    await updateQueueEventStatus(ev.event_id, { status: "queued", attempt_count: 0, last_error: null });
    qc.invalidateQueries({ queryKey: ["offline-queue", storeId] });
    toast.success("Re-queued for sync.");
  };

  return (
    <div className="pb-24">
      <SubpageHeader title="Sync Status" subtitle="Events + Offline-first Sales" />

      <div className="px-4 pt-4 space-y-4">
        {/* Summary */}
        <div className={`rounded-2xl border p-4 ${criticalCount > 0 ? "bg-red-50 border-red-200" : "bg-white border-stone-100"}`}>
          <SectionHeader
            title={criticalCount > 0 ? "Action needed" : "Sync looks good"}
            subtitle={criticalCount > 0 ? "Some items need your attention." : "Queued items will sync automatically when online."}
            right={<div className={`w-2.5 h-2.5 rounded-full ${navigator.onLine ? "bg-emerald-500" : "bg-stone-400"}`} />}
          />

          <div className="grid grid-cols-3 gap-2 text-center mt-4">
            <div className="bg-amber-50 rounded-xl py-2">
              <div className="text-lg font-bold text-amber-700">{(eventCounts?.queued || 0) + (eventCounts?.pushing || 0)}</div>
              <div className="text-[11px] text-amber-700">Events queued</div>
            </div>
            <div className="bg-blue-50 rounded-xl py-2">
              <div className="text-lg font-bold text-blue-700">{pendingSales.length}</div>
              <div className="text-[11px] text-blue-700">Sales pending</div>
            </div>
            <div className="bg-red-50 rounded-xl py-2">
              <div className="text-lg font-bold text-red-700">{criticalCount}</div>
              <div className="text-[11px] text-red-700">Needs help</div>
            </div>
          </div>

          <Button
            className="w-full h-12 mt-4 bg-blue-600 hover:bg-blue-700"
            onClick={runSyncAll}
            disabled={!navigator.onLine || isSyncingEvents || salesSync.isSyncing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${(isSyncingEvents || salesSync.isSyncing) ? "animate-spin" : ""}`} />
            Sync Now
          </Button>
          {!navigator.onLine ? <div className="text-center text-xs text-stone-500 mt-2">Offline — working locally.</div> : null}
        </div>

        <Tabs defaultValue="events">
          <TabsList className="w-full">
            <TabsTrigger value="events" className="flex-1">
              Events
            </TabsTrigger>
            <TabsTrigger value="sales" className="flex-1">
              Sales
            </TabsTrigger>
          </TabsList>

          {/* EVENTS */}
          <TabsContent value="events" className="space-y-3">
            <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                <div className="text-sm font-semibold text-stone-800">Event queue</div>
                <div className="flex items-center gap-2">
                  <Badge tone="amber">{groups.queued.length + groups.pushing.length} queued</Badge>
                  <Badge tone={groups.failed_permanent.length > 0 ? "red" : "orange"}>
                    {groups.failed_retry.length + groups.failed_permanent.length} failed
                  </Badge>
                </div>
              </div>

              {[...groups.failed_permanent, ...groups.failed_retry, ...groups.pushing, ...groups.queued].length === 0 ? (
                <div className="py-10 text-center text-sm text-stone-400">No queued events.</div>
              ) : (
                [...groups.failed_permanent, ...groups.failed_retry, ...groups.pushing, ...groups.queued]
                  .slice(0, 50)
                  .map((ev) => {
                    const cfg = EVENT_STATUS_LABEL[ev.status] || EVENT_STATUS_LABEL.queued;
                    const tone = cfg.tone;
                    const Icon = ev.status === "failed_permanent" ? AlertCircle : ev.status === "failed_retry" ? Clock : CheckCircle2;

                    return (
                      <div key={ev.event_id} className="px-4 py-3 border-b border-stone-50 last:border-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Icon className={`w-4 h-4 ${tone === "red" ? "text-red-600" : tone === "orange" ? "text-orange-600" : tone === "blue" ? "text-blue-600" : "text-stone-400"}`} />
                              <div className="text-sm font-medium text-stone-800 truncate">
                                {String(ev.event_type || "event").replace(/_/g, " ")}
                              </div>
                            </div>
                            <div className="text-[11px] text-stone-500 font-mono break-all mt-0.5">{ev.event_id}</div>
                            {ev.last_error ? <div className="text-[11px] text-red-600 mt-1">{ev.last_error}</div> : null}
                            {ev.created_at_device ? (
                              <div className="text-[11px] text-stone-400 mt-0.5">
                                {new Date(ev.created_at_device).toLocaleString("en-PH")}
                                {ev.attempt_count ? <span className="ml-2">• {ev.attempt_count} attempts</span> : null}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <Badge tone={tone}>{cfg.label}</Badge>
                            {(ev.status === "failed_retry" || ev.status === "failed_permanent" || ev.status === "queued") ? (
                              <button className="text-xs text-blue-700 font-semibold" onClick={() => retryEvent(ev)}>
                                Retry
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </TabsContent>

          {/* SALES */}
          <TabsContent value="sales" className="space-y-3">
            <div className="bg-white rounded-2xl border border-stone-100 p-4">
              <SectionHeader
                title="Offline-first sales"
                subtitle="Sales are recorded instantly and synced in the background."
                right={
                  <Button size="sm" className="h-9" onClick={() => salesSync.syncSales()} disabled={!navigator.onLine || salesSync.isSyncing}>
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${salesSync.isSyncing ? "animate-spin" : ""}`} />
                    Sync Sales
                  </Button>
                }
              />

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-blue-50 rounded-xl p-3">
                  <div className="text-[11px] text-blue-700">Pending</div>
                  <div className="text-xl font-bold text-blue-800">{pendingSales.length}</div>
                </div>
                <div className="bg-red-50 rounded-xl p-3">
                  <div className="text-[11px] text-red-700">Failed</div>
                  <div className="text-xl font-bold text-red-800">{failedSales.length}</div>
                </div>
              </div>
            </div>

            {/* Pending */}
            <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                <div className="text-sm font-semibold text-stone-800">Pending</div>
                <Badge tone="blue">{pendingSales.length}</Badge>
              </div>
              {pendingSales.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-400">No pending sales.</div>
              ) : (
                pendingSales.slice(0, 50).map((s) => (
                  <div key={s.sale_uuid} className="px-4 py-3 border-b border-stone-50 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-stone-800">Sale</div>
                        <div className="text-[11px] text-stone-500 font-mono break-all mt-0.5">{s.sale_uuid}</div>
                        <div className="text-[11px] text-stone-400 mt-0.5">{new Date(s.timestamp).toLocaleString("en-PH")}</div>
                      </div>
                      <Badge tone="blue">Pending</Badge>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Failed */}
            <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                <div className="text-sm font-semibold text-stone-800">Failed</div>
                <Badge tone="red">{failedSales.length}</Badge>
              </div>
              {failedSales.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-400">No failed sales.</div>
              ) : (
                failedSales.slice(0, 50).map((s) => (
                  <div key={s.sale_uuid} className="px-4 py-3 border-b border-stone-50 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-stone-800">Sale</div>
                        <div className="text-[11px] text-stone-500 font-mono break-all mt-0.5">{s.sale_uuid}</div>
                        {s.last_error ? <div className="text-[11px] text-red-600 mt-1">{s.last_error}</div> : null}
                        <div className="text-[11px] text-stone-400 mt-0.5">{new Date(s.timestamp).toLocaleString("en-PH")}</div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <Badge tone="red">Failed</Badge>
                        <div className="flex items-center gap-2">
                          <button
                            className="text-xs text-blue-700 font-semibold"
                            onClick={async () => {
                              await markSalesStatus(storeId, [s.sale_uuid], "pending", { errorMessage: null });
                              toast.success("Marked for retry.");
                              qc.invalidateQueries({ queryKey: ["pending-sales", storeId] });
                              qc.invalidateQueries({ queryKey: ["failed-sales", storeId] });
                            }}
                          >
                            Retry
                          </button>
                          <button
                            className="text-xs text-red-600 font-semibold inline-flex items-center gap-1"
                            onClick={async () => {
                              await deletePendingSales([s.sale_uuid]);
                              toast.success("Discarded.");
                              qc.invalidateQueries({ queryKey: ["failed-sales", storeId] });
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Discard
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
