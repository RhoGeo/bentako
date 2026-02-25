// Backwards-compatible re-export.
// Canonical Step 5 implementation lives in: src/lib/sync/SyncManager.js

export { syncNow, pushQueuedEvents, pullUpdates, startAutoSync } from "@/lib/sync/SyncManager";
