import React, { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Store, ChevronRight, Layers } from "lucide-react";
import { useMyStores } from "@/components/lib/storeScope";
import { useStoreScope, getActiveStoreId } from "@/components/lib/storeScope";

export default function StoreSwitcher() {
  const navigate = useNavigate();
  const { storeId, setStoreId } = useStoreScope();
  const storesQ = useMyStores();
  const stores = storesQ.data || [];

  const active = getActiveStoreId();
  const hasMultiple = stores.length > 1;
  const activeIsValid = !!stores.find((s) => s.id === active);
  const isOwnerAny = stores.some((s) => String(s.membership?.role || "").toLowerCase() === "owner");

  useEffect(() => {
    if (storesQ.isLoading) return;
    if (!stores.length) return;
    if (!hasMultiple) {
      const only = stores[0];
      if (only?.id) {
        setStoreId(only.id);
        navigate(createPageUrl("Counter"), { replace: true });
      }
      return;
    }
    // If previously selected store is still valid, let user continue.
    if (activeIsValid && active) {
      setStoreId(active);
      navigate(createPageUrl("Counter"), { replace: true });
    }
  }, [storesQ.isLoading]);

  if (storesQ.isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasMultiple) {
    // Will auto-redirect in effect.
    return null;
  }

  return (
    <div className="min-h-[100dvh] bg-stone-50 px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-stone-800">Select Store</h1>
            <p className="text-xs text-stone-500">Choose which store you want to work on.</p>
          </div>
        </div>

        {isOwnerAny && (
          <Link to={createPageUrl("CombinedView")}>
            <div className="bg-white rounded-xl border border-stone-100 px-4 py-3 flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Layers className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-stone-800">Owner Combined View</p>
                <p className="text-[11px] text-stone-400">Read-only analytics across stores</p>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </div>
          </Link>
        )}

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {stores.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => {
                setStoreId(s.id);
                navigate(createPageUrl("Counter"), { replace: true });
              }}
              className={`w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-stone-50 ${idx < stores.length - 1 ? "border-b border-stone-50" : ""}`}
            >
              <div className="w-10 h-10 rounded-lg bg-stone-50 flex items-center justify-center flex-shrink-0">
                <Store className="w-5 h-5 text-stone-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-stone-800 truncate">{s.store_name || s.name || s.id}</p>
                <p className="text-[11px] text-stone-400 truncate">{s.id}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
