import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ConnectionBadge from "@/components/global/ConnectionBadge";
import SyncBanner from "@/components/global/SyncBanner";
import StopTheLineBanner from "@/components/global/StopTheLineBanner";
import SafeDefaultsBanner from "@/components/global/SafeDefaultsBanner";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, ScanLine, Package, MoreHorizontal, Store, Menu, RefreshCw, AlertTriangle } from "lucide-react";
import { Toaster } from "sonner";
import { toast } from "sonner";
import { getOfflineQueueCounts } from "@/lib/db";
import { syncNow, startAutoSync } from "@/components/lib/syncManager";
import { setActiveStoreId, useActiveStoreId, hasActiveStoreSelection } from "@/components/lib/activeStore";
import { useStoresForUser } from "@/components/lib/useStores";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useOfflineSync } from "@/hooks/useOfflineSync";

const NAV_ITEMS = [
  { label: "Reports", icon: BarChart3, page: "Reports" },
  { label: "Today", icon: CalendarDays, page: "Today" },
  { label: "Counter", icon: ScanLine, page: "Counter" },
  { label: "Items", icon: Package, page: "Items" },
  { label: "More", icon: MoreHorizontal, page: "More" },
];

const PAGE_TITLES = {
  Reports: "Reports",
  Today: "Today",
  Counter: "Counter",
  Items: "Items",
  More: "More",
  SyncStatus: "Sync",
  SalesLog: "Sales Log",
  ProductForm: "Item",
  CustomersDue: "Customers (Utang)",
  Staff: "Staff & Roles",
  StoreSettings: "Store Settings",
  Devices: "Devices",
  StoreSwitcher: "Select Store",
  RestockChecklist: "Restock",
  Permissions: "Permissions",
  MyStores: "My Stores",
  Affiliate: "Affiliate",
  Payouts: "Payouts",
  CombinedView: "Combined View",
  OperatingPolicy: "Operating Policy",
};

// Pages that show the bottom nav
const TAB_PAGES = ["Reports", "Today", "Counter", "Items", "More"];

export default function Layout({ children, currentPageName }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [storeSwitcherOpen, setStoreSwitcherOpen] = useState(false);
  const showTabs = TAB_PAGES.includes(currentPageName);
  const { storeId } = useActiveStoreId();
  const salesSync = useOfflineSync({ storeId });
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
  const pendingSalesCount = salesSync?.pendingCount || 0;
  const failedSalesCount = salesSync?.failedCount || 0;

  const combinedQueuedCount = queuedCount + pendingSalesCount;
  const combinedFailedCount = failedPermanentCount + failedSalesCount;

  const stopTheLineReasons =
    combinedFailedCount > 0
      ? [`${combinedFailedCount} issue(s) need attention — tap Sync for details.`]
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
      // Run both sync systems (events + offline-first sales)
      await Promise.allSettled([
        syncNow(storeId),
        salesSync?.syncSales?.(),
      ]);
    } finally {
      setIsSyncing(false);
    }
  };

  const pageTitle = PAGE_TITLES[currentPageName] || currentPageName;

  const menuLinks = useMemo(
    () => [
      { label: "Sync", page: "SyncStatus" },
      { label: "Sales Log", page: "SalesLog" },
      { label: "Customers (Utang)", page: "CustomersDue" },
      { label: "Staff & Roles", page: "Staff" },
      { label: "Store Settings", page: "StoreSettings" },
      { label: "Devices", page: "Devices" },
    ],
    []
  );

  return (
    <div className="min-h-[100dvh] bg-stone-50 flex flex-col">
      <Toaster position="top-center" richColors closeButton />

      {/* App menu (tabs only) */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="p-0 w-[86vw] max-w-sm">
          <div className="bg-blue-600 text-white px-4 pt-5 pb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold leading-tight">{settings?.store_name || "My Store"}</div>
                <div className="text-[11px] text-blue-100">Store ID: {storeId || "—"}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-blue-50">{salesSync?.statusText}</div>
              <button
                className="text-xs bg-white/15 px-3 py-1.5 rounded-full"
                onClick={() => setStoreSwitcherOpen(true)}
              >
                Switch store
              </button>
            </div>
          </div>

          <div className="px-3 py-3">
            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold px-2 pb-2">
              Main
            </div>
            <div className="space-y-1">
              {NAV_ITEMS.map((it) => (
                <Link
                  key={it.page}
                  to={createPageUrl(it.page)}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-stone-50 active:bg-stone-100"
                >
                  <it.icon className="w-5 h-5 text-stone-600" />
                  <span className="text-sm font-medium text-stone-700">{it.label}</span>
                </Link>
              ))}
            </div>

            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold px-2 pt-5 pb-2">
              Shortcuts
            </div>
            <div className="space-y-1">
              {menuLinks.map((it) => (
                <Link
                  key={it.page}
                  to={createPageUrl(it.page)}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-stone-50 active:bg-stone-100"
                >
                  <span className="text-sm text-stone-700">{it.label}</span>
                  <span className="text-xs text-stone-400">›</span>
                </Link>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

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

      {/* Top Bar (tabs only) */}
      {showTabs && (
      <header className="sticky top-0 z-40">
        {/* Primary app bar */}
        <div className="bg-blue-600 text-white shadow-sm">
          <div className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2">
              <button
                className="touch-target rounded-xl hover:bg-white/10 active:bg-white/15 px-2"
                aria-label="Open menu"
                onClick={() => setMenuOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </button>

              <button
                className="text-left"
                onClick={() => {
                  if (stores && stores.length > 1) setStoreSwitcherOpen(true);
                }}
              >
                <div className="text-sm font-bold leading-tight">
                  {settings?.store_name || "My Store"}
                </div>
                <div className="text-[11px] text-blue-100">
                  {stores && stores.length > 1 ? "Tap to switch store" : pageTitle}
                </div>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSyncDrawerOpen(true)}
                className="touch-target px-2 rounded-xl hover:bg-white/10 active:bg-white/15"
                aria-label="Open sync status"
              >
                <RefreshCw className={`w-5 h-5 ${(salesSync?.isSyncing || isSyncing) ? "animate-spin" : ""}`} />
              </button>
              <ConnectionBadge
                status={(salesSync?.isSyncing || isSyncing) ? "syncing" : (isOnline ? "online" : "offline")}
                queuedCount={combinedQueuedCount}
                failedCount={combinedFailedCount}
                onTap={() => setSyncDrawerOpen(true)}
              />
            </div>
          </div>

          {/* Secondary status line */}
          <div className="px-4 pb-2 flex items-center justify-between text-[11px] text-blue-100">
            <div>{salesSync?.statusText}</div>
            {combinedFailedCount > 0 ? (
              <div className="flex items-center gap-1 text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{combinedFailedCount} issue(s)</span>
              </div>
            ) : null}
          </div>
        </div>

        <StopTheLineBanner reasons={stopTheLineReasons} />
        <SafeDefaultsBanner show={isUsingSafeDefaults} />
        <SyncBanner
          queuedCount={combinedQueuedCount}
          failedCount={combinedFailedCount}
          isSyncing={isSyncing || salesSync?.isSyncing}
          onSyncNow={handleSyncNow}
          onViewDetails={() => setSyncDrawerOpen(true)}
        />
      </header>
      )}

      {/* Sync drawer (tabs only) */}
      <Sheet open={syncDrawerOpen} onOpenChange={setSyncDrawerOpen}>
        <SheetContent side="bottom" className="p-0 rounded-t-2xl">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>Sync Status</SheetTitle>
            <p className="text-xs text-stone-500">Events + Sales sync summary</p>
          </SheetHeader>
          <div className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white border border-stone-100 rounded-2xl p-3">
                <div className="text-[11px] text-stone-500">Queued</div>
                <div className="text-2xl font-bold text-stone-800">{combinedQueuedCount}</div>
              </div>
              <div className={`border rounded-2xl p-3 ${combinedFailedCount > 0 ? "bg-red-50 border-red-200" : "bg-white border-stone-100"}`}>
                <div className={`text-[11px] ${combinedFailedCount > 0 ? "text-red-600" : "text-stone-500"}`}>Needs attention</div>
                <div className={`text-2xl font-bold ${combinedFailedCount > 0 ? "text-red-700" : "text-stone-800"}`}>{combinedFailedCount}</div>
              </div>
            </div>

            <button
              className={`w-full h-12 rounded-2xl font-semibold flex items-center justify-center gap-2 touch-target ${navigator.onLine ? "bg-blue-600 text-white" : "bg-stone-200 text-stone-500"}`}
              onClick={handleSyncNow}
              disabled={!navigator.onLine || isSyncing || salesSync?.isSyncing}
            >
              <RefreshCw className={`w-4 h-4 ${(isSyncing || salesSync?.isSyncing) ? "animate-spin" : ""}`} />
              Sync Now
            </button>

            <Link
              to={createPageUrl("SyncStatus")}
              onClick={() => setSyncDrawerOpen(false)}
              className="w-full h-12 rounded-2xl border border-stone-200 bg-white flex items-center justify-between px-4"
            >
              <div>
                <div className="text-sm font-semibold text-stone-800">Open details</div>
                <div className="text-[11px] text-stone-500">Retry / discard failed items</div>
              </div>
              <span className="text-stone-400">›</span>
            </Link>
          </div>
        </SheetContent>
      </Sheet>

      {/* Content */}
      <main className="flex-1 overflow-y-auto scroll-smooth">{children}</main>

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