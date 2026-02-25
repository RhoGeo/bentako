import React from "react";
import { ArrowLeft, RefreshCw, CheckCircle2, AlertCircle, Clock, AlertOctagon, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { listOfflineQueue, updateQueueEventStatus } from "@/lib/db";
import { syncNow } from "@/components/lib/syncManager";
import { useActiveStoreId } from "@/components/lib/activeStore";

const STATUS_CONFIGS = {
  queued: { color: "text-amber-600", bg: "bg-amber-50", label: "Queued" },
  pushing: { color: "text-blue-600", bg: "bg-blue-50", label: "Pushing" },
  applied: { color: "text-emerald-600", bg: "bg-emerald-50", label: "Applied" },
  failed_retry: { color: "text-orange-600", bg: "bg-orange-50", label: "Failed (retry)" },
  failed_permanent: { color: "text-red-700", bg: "bg-red-100", label: "Failed (permanent)" },
  duplicate_ignored: { color: "text-stone-500", bg: "bg-stone-100", label: "Duplicate" },
};

export default function SyncStatus() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { user } = useCurrentStaff(storeId);
  const [isSyncing, setIsSyncing] = React.useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["offline-queue", storeId],
    queryFn: () => listOfflineQueue(storeId),
    refetchInterval: 3_000,
    initialData: [],
  });

  const queued = events.filter((e) => e.status === "queued");
  const pushing = events.filter((e) => e.status === "pushing");
  const failedRetry = events.filter((e) => e.status === "failed_retry");
  const failedPermanent = events.filter((e) => e.status === "failed_permanent");
  const applied = events.filter((e) => e.status === "applied" || e.status === "duplicate_ignored");

  const hasCritical = failedPermanent.length > 0;

  const handleSyncNow = async () => {
    if (!navigator.onLine) { toast.error("Offline — cannot sync now."); return; }
    setIsSyncing(true);
    try {
      await syncNow(storeId);
      queryClient.invalidateQueries({ queryKey: ["offline-queue", storeId] });
      toast.success("Sync complete!");
    } finally {
      setIsSyncing(false);
    }
  };

  const retryEvent = async (ev) => {
    await updateQueueEventStatus(ev.event_id, { status: "queued", attempt_count: 0, last_error: null });
    queryClient.invalidateQueries({ queryKey: ["offline-queue", storeId] });
    toast.success("Event re-queued.");
  };

  const EventRow = ({ ev }) => {
    const cfg = STATUS_CONFIGS[ev.status] || STATUS_CONFIGS.queued;
    return (
      <div className="flex items-start gap-3 px-4 py-3 border-b border-stone-50 last:border-0">
        <div className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${cfg.bg} ${cfg.color}`}>{cfg.label}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-stone-700 capitalize">{ev.event_type?.replace(/_/g, " ")}</p>
          <p className="text-[10px] text-stone-400 font-mono">{ev.event_id}</p>
          {ev.last_error && <p className="text-[10px] text-red-500 mt-0.5">{ev.last_error}</p>}
          {ev.created_at_device && (
            <p className="text-[10px] text-stone-400">{new Date(ev.created_at_device).toLocaleString("en-PH")}</p>
          )}
          {ev.attempt_count > 0 && <p className="text-[10px] text-stone-400">{ev.attempt_count} attempts</p>}
        </div>
        {(ev.status === "queued" || ev.status === "failed_retry" || ev.status === "failed_permanent") && (
          <button onClick={() => retryEvent(ev)} className="text-xs text-blue-600 font-medium flex-shrink-0">Retry</button>
        )}
      </div>
    );
  };

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800">Sync</h1>
      </div>

      {hasCritical && (
        <div className="bg-red-600 px-4 py-3 flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-white flex-shrink-0" />
          <p className="text-white text-xs font-bold">May hindi ma-sync. Kailangan ayusin ngayon.</p>
        </div>
      )}

      <div className="px-4 py-4 space-y-4">
        {/* Status card */}
        <div className="bg-white rounded-xl border border-stone-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {hasCritical ? (
                <AlertCircle className="w-5 h-5 text-red-500" />
              ) : queued.length > 0 ? (
                <Clock className="w-5 h-5 text-amber-500" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              )}
              <span className="font-semibold text-stone-800 text-sm">
                {hasCritical ? "Action needed" : queued.length > 0 ? `${queued.length} queued` : "All synced"}
              </span>
            </div>
            <div className={`w-2 h-2 rounded-full ${navigator.onLine ? "bg-emerald-500" : "bg-stone-400"}`} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs mb-4">
            <div className="bg-amber-50 rounded-lg py-2">
              <p className="font-bold text-amber-700 text-lg">{queued.length + pushing.length}</p>
              <p className="text-amber-600">Queued</p>
            </div>
            <div className="bg-orange-50 rounded-lg py-2">
              <p className="font-bold text-orange-700 text-lg">{failedRetry.length}</p>
              <p className="text-orange-600">Retrying</p>
            </div>
            <div className="bg-red-50 rounded-lg py-2">
              <p className="font-bold text-red-700 text-lg">{failedPermanent.length}</p>
              <p className="text-red-600">Failed</p>
            </div>
          </div>
          <Button
            className="w-full h-11 bg-blue-600 hover:bg-blue-700 touch-target"
            onClick={handleSyncNow}
            disabled={isSyncing || !navigator.onLine}
          >
            {isSyncing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {isSyncing ? "Syncing…" : "Sync Now"}
          </Button>
          {!navigator.onLine && <p className="text-center text-xs text-stone-400 mt-2">Offline — connect to sync.</p>}
        </div>

        {/* Queue viewer */}
        <Tabs defaultValue="queued">
          <TabsList className="w-full">
            <TabsTrigger value="queued" className="flex-1">Queued ({queued.length})</TabsTrigger>
            <TabsTrigger value="failed" className="flex-1">Failed ({failedRetry.length + failedPermanent.length})</TabsTrigger>
            <TabsTrigger value="done" className="flex-1">Done ({applied.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="queued">
            <div className="bg-white rounded-xl border border-stone-100 mt-2">
              {[...queued, ...pushing].length === 0 ? (
                <div className="text-center py-8 text-stone-400 text-sm">No queued events.</div>
              ) : [...queued, ...pushing].map(ev => <EventRow key={ev.event_id} ev={ev} />)}
            </div>
          </TabsContent>
          <TabsContent value="failed">
            <div className="bg-white rounded-xl border border-stone-100 mt-2">
              {[...failedRetry, ...failedPermanent].length === 0 ? (
                <div className="text-center py-8 text-stone-400 text-sm">No failed events.</div>
              ) : [...failedRetry, ...failedPermanent].map(ev => <EventRow key={ev.event_id} ev={ev} />)}
            </div>
          </TabsContent>
          <TabsContent value="done">
            <div className="bg-white rounded-xl border border-stone-100 mt-2">
              {applied.length === 0 ? (
                <div className="text-center py-8 text-stone-400 text-sm">No synced events yet.</div>
              ) : applied.slice(0, 20).map(ev => <EventRow key={ev.event_id} ev={ev} />)}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}