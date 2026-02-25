import React, { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Store, ChevronRight, Layers } from "lucide-react";
import { useStoresForUser } from "@/components/lib/useStores";
import { setActiveStoreId, useActiveStoreId, hasActiveStoreSelection } from "@/components/lib/activeStore";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function StoreSwitcher() {
  const navigate = useNavigate();
  const { storeId } = useActiveStoreId();
  const { stores, isLoading, user } = useStoresForUser({ includeArchived: false });

  const { data: myMemberships = [] } = useQuery({
    queryKey: ["my-memberships", user?.email],
    enabled: !!user?.email,
    queryFn: () => base44.entities.StaffMember.filter({ user_email: user.email, is_active: true }),
    initialData: [],
    staleTime: 60_000,
  });

  const hasMultiple = stores.length > 1;
  const allowed = new Set(stores.map((s) => s.store_id));
  const activeIsValid = allowed.has(storeId);
  const isOwnerAny = myMemberships.some((m) => m.role === "owner");

  useEffect(() => {
    if (isLoading) return;
    if (!stores.length) return;

    if (!hasMultiple) {
      const only = stores[0]?.store_id;
      if (only) {
        setActiveStoreId(only);
        navigate(createPageUrl("Counter"), { replace: true });
      }
      return;
    }

    if (activeIsValid && hasActiveStoreSelection()) {
      navigate(createPageUrl("Counter"), { replace: true });
    }
  }, [isLoading, stores.length, hasMultiple, activeIsValid]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasMultiple) {
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
              key={s.store_id}
              onClick={() => {
                setActiveStoreId(s.store_id);
                navigate(createPageUrl("Counter"), { replace: true });
              }}
              className={`w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-stone-50 ${
                idx < stores.length - 1 ? "border-b border-stone-50" : ""
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-stone-50 flex items-center justify-center flex-shrink-0">
                <Store className="w-5 h-5 text-stone-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-stone-800 truncate">{s.store_name || s.store_id}</p>
                <p className="text-[11px] text-stone-400 truncate">{s.store_id}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
