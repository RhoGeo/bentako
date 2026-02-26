import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/auth/session";
import {
  listPendingSales,
  getPendingSalesCounts,
  markSalesStatus,
  deletePendingSales,
  resetStaleSyncing,
} from "@/lib/db";

/**
 * useOfflineSync — Offline-first sales bulk sync
 *
 * - Checkout writes to Dexie pendingSales and returns instantly.
 * - This hook syncs pending sales in the background when:
 *   - browser goes online
 *   - app starts (if online)
 *   - a pending sale is enqueued (custom event)
 *
 * Backend: Vercel Serverless Function
 *  POST /api/sales/bulk-sync
 *  headers: x-posync-access-token (custom)
 *  body: { store_id, sales: [{ sale_uuid, store_id, device_id, sale, cartItems, totalAmount, timestamp }] }
 *  response: { processed: [sale_uuid...], failed?: [{ sale_uuid, message, permanent? }] }
 */
export function useOfflineSync({ storeId, endpoint = "/api/sales/bulk-sync" } = {}) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastError, setLastError] = useState(null);

  const inFlight = useRef(false);

  const refreshCounts = useCallback(async () => {
    if (!storeId) return;
    const c = await getPendingSalesCounts(storeId);
    setPendingCount(c.pending || 0);
    setFailedCount(c.failed || 0);
  }, [storeId]);

  const syncSales = useCallback(async () => {
    if (!storeId) return;
    if (inFlight.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    inFlight.current = true;
    setIsSyncing(true);
    setLastError(null);

    try {
      await resetStaleSyncing(storeId);

      const pending = await listPendingSales(storeId);
      if (!pending.length) {
        await refreshCounts();
        return;
      }

      const saleUuids = pending.map((s) => s.sale_uuid);

      await markSalesStatus(storeId, saleUuids, "syncing");

      const access = getAccessToken();
      if (!access) {
        await markSalesStatus(storeId, saleUuids, "pending", { errorMessage: "AUTH_REQUIRED" });
        throw new Error("AUTH_REQUIRED");
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-posync-access-token": access,
        },
        body: JSON.stringify({
          store_id: storeId,
          sales: pending.map((s) => ({
            sale_uuid: s.sale_uuid,
            store_id: s.store_id,
            device_id: s.device_id,
            sale: s.sale,
            cartItems: s.cartItems,
            totalAmount: s.totalAmount,
            timestamp: s.timestamp,
          })),
        }),
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        await markSalesStatus(storeId, saleUuids, "pending", { errorMessage: (json?.error || text || res.statusText) });
        throw new Error(json?.error || text || res.statusText || `Sync failed (${res.status})`);
      }

      const processed = Array.isArray(json?.processed) ? json.processed : [];
      const failed = Array.isArray(json?.failed) ? json.failed : [];

      if (processed.length) {
        await deletePendingSales(processed);
      }

      // Anything not processed should remain pending or be marked failed
      const processedSet = new Set(processed);
      const leftover = saleUuids.filter((id) => !processedSet.has(id));
      const failedMap = new Map(failed.map((f) => [f.sale_uuid, f]));

      const toFailed = [];
      const toPending = [];

      for (const id of leftover) {
        const f = failedMap.get(id);
        if (f?.permanent) toFailed.push({ id, message: f.message || "Failed" });
        else toPending.push({ id, message: f?.message || null });
      }

      if (toFailed.length) {
        await markSalesStatus(
          storeId,
          toFailed.map((x) => x.id),
          "failed",
          { errorMessage: "Permanent failure (see details)" }
        );
      }
      if (toPending.length) {
        await markSalesStatus(
          storeId,
          toPending.map((x) => x.id),
          "pending",
          { errorMessage: toPending.find((x) => x.message)?.message || null }
        );
      }

      await refreshCounts();
    } catch (e) {
      setLastError(e?.message || String(e));
      await refreshCounts();
    } finally {
      inFlight.current = false;
      setIsSyncing(false);
    }
  }, [endpoint, refreshCounts, storeId]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      syncSales();
    };
    const onOffline = () => setIsOnline(false);
    const onPendingSale = (ev) => {
      const s = ev?.detail?.store_id;
      if (!s || s === storeId) {
        if (navigator.onLine) syncSales();
        refreshCounts();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("posync:pending_sale_enqueued", onPendingSale);

    // initial
    refreshCounts();
    if (navigator.onLine) syncSales();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("posync:pending_sale_enqueued", onPendingSale);
    };
  }, [refreshCounts, storeId, syncSales]);

  const statusText = isSyncing
    ? `🔄 Syncing ${pendingCount} Pending Sales...`
    : isOnline
      ? "🟢 Online"
      : "🔴 Offline - Working Locally";

  return {
    isOnline,
    isSyncing,
    pendingCount,
    failedCount,
    lastError,
    statusText,
    syncSales,
    refreshCounts,
  };
}
