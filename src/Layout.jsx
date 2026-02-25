import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ConnectionBadge from "@/components/global/ConnectionBadge";
import SyncBanner from "@/components/global/SyncBanner";
import StopTheLineBanner from "@/components/global/StopTheLineBanner";
import SafeDefaultsBanner from "@/components/global/SafeDefaultsBanner";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, ScanLine, Package, MoreHorizontal, Store } from "lucide-react";
import { Toaster } from "sonner";
import { toast } from "sonner";
import { getOfflineQueueCounts } from "@/lib/db";
import { syncNow, startAutoSync } from "@/components/lib/syncManager";
import { setActiveStoreId, useActiveStoreId, hasActiveStoreSelection } from "@/components/lib/activeStore";
import { useStoresForUser } from "@/components/lib/useStores";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const NAV_ITEMS = [
  { label: "Reports", icon: BarChart3, page: "Reports" },
  { label: "Today", icon: CalendarDays, page: "Today" },
  { label: "Counter", icon: ScanLine, page: "Counter" },
  { label: "Items", icon: Package, page: "Items" },
  { label: "More", icon: MoreHorizontal, page: "More" },
];

// Pages that show the bottom nav
const TAB_PAGES = ["Reports", "Today", "Counter", "Items", "More"];

export default function Layout({ children, currentPageName }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [storeSwitcherOpen, setStoreSwitcherOpen] = useState(false);
  const showTabs = TAB_PAGES.includes(currentPageName);
  const { storeId } = useActiveStoreId();
  const { stores, isLoading: storesLoading } = useStoresForUser();
  const storeIdOf = (s) => s?.id || s?.store_id;
  const { isUsingSafeDefaults, settings } = useStoreSettings(storeId);

  const { data: queueCounts } = useQuery({
    queryKey: ["offline-queue-counts", storeId],
    queryFn: () => getOfflineQueueCounts(storeId),
    refetchInterval: 4_000,
    initialData: { queued: 0, pushing: 0, failed_permanent: 0, total: 0 },
  });

  const queuedCount = queueCounts?.queued || 0;
  const failedPermanentCount = queueCounts?.failed_permanent || 0;
  const stopTheLineReasons =
    failedPermanentCount > 0
      ? [`${failedPermanentCount} event(s) failed permanently — kailangan ayusin.`]
      : [];

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    const stop = startAutoSync({ getStoreId: () => storeId });
    return () => stop?.();
  }, [storeId]);

  // Multi-store enforcement: if user has multiple stores and no explicit selection, force pick.
  useEffect(() => {
    // Wait until the query is truly done (not just loading) before acting.
    if (storesLoading) return;

    // No stores: routing gate (AppRouter) will send user to /first-store.
    if (!stores || stores.length === 0) return;

    const allowed = new Set(stores.map(storeIdOf));
    const hasSelection = hasActiveStoreSelection();

    // If active store is not allowed, auto-correct to the first allowed store.
    if (!allowed.has(storeId)) {
      const fallback = storeIdOf(stores[0]);
      setActiveStoreId(fallback);
      toast.message("Store updated", { description: "Switched to an allowed store." });
      return;
    }

    if (stores.length > 1 && !hasSelection) {
      setStoreSwitcherOpen(true);
    }

    if (stores.length === 1 && !hasSelection) {
      // Auto-select the only store to keep UX smooth.
      setActiveStoreId(storeIdOf(stores[0]));
    }
  }, [storesLoading, stores, storeId]);

  const handleSyncNow = async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try {
      await syncNow(storeId);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-stone-50 flex flex-col">
      <Toaster position="top-center" richColors closeButton />

      {/* Store Switcher (forced when multiple stores and none chosen) */}
      <Sheet open={storeSwitcherOpen} onOpenChange={setStoreSwitcherOpen}>
        <SheetContent side="bottom" className="p-0">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>Select Store</SheetTitle>
            <p className="text-xs text-stone-500">Pumili ng store na gagamitin ngayon.</p>
          </SheetHeader>
          <div className="px-4 pb-4 space-y-2">
            {storesLoading ? (
              <div className="text-sm text-stone-500 py-6">Loading stores…</div>
            ) : (
              stores.map((s) => (
                <button
                  key={storeIdOf(s)}
                  onClick={() => {
                    setActiveStoreId(storeIdOf(s));
                    setStoreSwitcherOpen(false);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-xl border touch-target transition-colors ${
                    storeIdOf(s) === storeId
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-stone-700 border-stone-200"
                  }`}
                >
                  <div className="font-semibold text-sm">{s.store_name}</div>
                  <div className={`text-[11px] ${storeIdOf(s) === storeId ? "text-blue-100" : "text-stone-400"}`}>{storeIdOf(s)}</div>
                </button>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Top Bar */}
      {showTabs && (
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-stone-100">
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <Store className="w-4 h-4 text-white" />
              </div>
              <div>
                <button
                  className="text-left"
                  onClick={() => {
                    if (stores && stores.length > 1) setStoreSwitcherOpen(true);
                  }}
                >
                  <h1 className="text-sm font-bold text-stone-800 leading-tight">
                    {settings?.store_name || "My Sari-Sari"}
                  </h1>
                  {stores && stores.length > 1 && (
                    <p className="text-[10px] text-stone-400">Tap to switch store</p>
                  )}
                </button>
              </div>
            </div>
            <ConnectionBadge
              status={isOnline ? "online" : "offline"}
              onTap={() => setSyncDrawerOpen(true)}
            />
          </div>
          <StopTheLineBanner reasons={stopTheLineReasons} />
          <SafeDefaultsBanner show={isUsingSafeDefaults} />
          <SyncBanner
            queuedCount={queuedCount}
            failedCount={failedPermanentCount}
            isSyncing={isSyncing}
            onSyncNow={handleSyncNow}
            onViewDetails={() => setSyncDrawerOpen(true)}
          />
        </header>
      )}

      {/* Content */}
      <main className="flex-1 overflow-y-auto">{children}</main>

      {/* Bottom Tabs */}
      {showTabs && (
        <nav className="sticky bottom-0 z-40 bg-white border-t border-stone-200 safe-bottom">
          <div className="flex items-stretch">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = currentPageName === item.page;
              const isCounter = item.page === "Counter";
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={`flex-1 flex flex-col items-center justify-center py-2 transition-colors no-select ${
                    isActive
                      ? "text-blue-600"
                      : "text-stone-400 active:text-stone-600"
                  }`}
                >
                  {isCounter ? (
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center -mt-3 shadow-md ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-stone-800 text-white"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                  <span
                    className={`text-[10px] font-medium mt-0.5 ${
                      isCounter ? "mt-1" : ""
                    }`}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}