import React, { useMemo, useState } from "react";
// no routing needed here; SubpageHeader handles back navigation
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Clock, RefreshCw } from "lucide-react";

import SubpageHeader from "@/components/layout/SubpageHeader";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveStoreId } from "@/components/lib/activeStore";

import {
  listOfflineQueue,
  updateQueueEventStatus,
  getOfflineQueueCounts,
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
  const criticalCount = groups.failed_permanent.length;

  const runSyncAll = async () => {
    if (!navigator.onLine) {
      toast.error("Offline — connect to sync.");
      return;
    }
    setIsSyncingEvents(true);
    try {
      await syncNow(storeId);
      toast.success("Sync completed.");
      qc.invalidateQueries({ queryKey: ["offline-queue", storeId] });
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
      <SubpageHeader title="Sync Status" subtitle="Queued events will sync when online" />

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
              <div className="text-lg font-bold text-blue-700">{eventCounts?.pushing || 0}</div>
              <div className="text-[11px] text-blue-700">Sending now</div>
            </div>
            <div className="bg-red-50 rounded-xl py-2">
              <div className="text-lg font-bold text-red-700">{criticalCount}</div>
              <div className="text-[11px] text-red-700">Needs help</div>
            </div>
          </div>

          <Button
            className="w-full h-12 mt-4 bg-blue-600 hover:bg-blue-700"
            onClick={runSyncAll}
            disabled={!navigator.onLine || isSyncingEvents}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncingEvents ? "animate-spin" : ""}`} />
            Sync Now
          </Button>
          {!navigator.onLine ? <div className="text-center text-xs text-stone-500 mt-2">Offline — working locally.</div> : null}
        </div>

        <Tabs defaultValue="events">
          <TabsList className="w-full">
            <TabsTrigger value="events" className="flex-1">Events</TabsTrigger>
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
        </Tabs>
      </div>
    </div>
  );
}
