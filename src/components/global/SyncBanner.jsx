import React from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SyncBanner({ queuedCount = 0, failedCount = 0, isSyncing = false, onSyncNow, onViewDetails }) {
  if (queuedCount === 0 && failedCount === 0) return null;

  const isUrgent = failedCount > 0;

  return (
    <div
      className={`px-4 py-2.5 flex items-center justify-between gap-3 ${
        isUrgent ? "bg-red-50 border-b border-red-200" : "bg-amber-50 border-b border-amber-200"
      }`}
    >
      <button onClick={onViewDetails} className="flex items-center gap-2 flex-1 min-w-0">
        {isUrgent ? (
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
        ) : (
          <RefreshCw className="w-4 h-4 text-amber-600 flex-shrink-0" />
        )}
        <div className="text-left min-w-0">
          <p className={`text-xs font-medium ${isUrgent ? "text-red-700" : "text-amber-700"}`}>
            Queued: {queuedCount}
            {failedCount > 0 && <span className="text-red-600 ml-2">Failed: {failedCount}</span>}
          </p>
          {isUrgent && (
            <p className="text-[10px] text-red-500">May events na di ma-sync. Tap para makita.</p>
          )}
        </div>
      </button>
      <Button
        size="sm"
        variant={isUrgent ? "destructive" : "default"}
        className="h-8 px-3 text-xs touch-target flex-shrink-0"
        onClick={onSyncNow}
        disabled={isSyncing}
      >
        {isSyncing ? (
          <RefreshCw className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <RefreshCw className="w-3 h-3 mr-1" />
        )}
        Sync Now
      </Button>
    </div>
  );
}