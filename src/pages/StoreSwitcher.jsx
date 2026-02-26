import React, { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Store, ChevronRight, Layers } from "lucide-react";
import SubpageHeader from "@/components/layout/SubpageHeader";
import { useStoresForUser } from "@/components/lib/useStores";
import { getActiveStoreId, setActiveStoreId } from "@/components/lib/activeStore";

export default function StoreSwitcher() {
  const navigate = useNavigate();
  const storesQ = useStoresForUser();
  const stores = storesQ.stores || [];

  const active = getActiveStoreId();
  const hasMultiple = stores.length > 1;
  const storeIdOf = (s) => s?.id || s?.store_id;
  const activeIsValid = !!stores.find((s) => storeIdOf(s) === active);
  const memberships = storesQ.memberships || [];
  const isOwnerAny = memberships.some((m) => String(m.role || "").toLowerCase() === "owner");

  useEffect(() => {
    if (storesQ.isLoading) return;
    if (!stores.length) return;
    if (!hasMultiple) {
      const only = stores[0];
      const onlyId = storeIdOf(only);
      if (onlyId) {
        setActiveStoreId(onlyId);
        navigate(createPageUrl("Counter"), { replace: true });
      }
      return;
    }
    // If previously selected store is still valid, let user continue.
    if (activeIsValid && active) {
      setActiveStoreId(active);
      navigate(createPageUrl("Counter"), { replace: true });
    }
  }, [storesQ.isLoading, stores.length, hasMultiple, activeIsValid, active]);

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
    <div className="pb-24">
      <SubpageHeader title="Select Store" subtitle="Choose which store you want to work on" />

      <div className="px-4 py-6 max-w-md mx-auto">

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
            (() => {
              const sid = storeIdOf(s);
              const name = s.store_name || s.name || sid;
              return (
            <button
              key={sid}
              onClick={() => {
                setActiveStoreId(sid);
                navigate(createPageUrl("Counter"), { replace: true });
              }}
              className={`w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-stone-50 ${idx < stores.length - 1 ? "border-b border-stone-50" : ""}`}
            >
              <div className="w-10 h-10 rounded-lg bg-stone-50 flex items-center justify-center flex-shrink-0">
                <Store className="w-5 h-5 text-stone-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-stone-800 truncate">{name}</p>
                <p className="text-[11px] text-stone-400 truncate">{sid}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </button>
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}
