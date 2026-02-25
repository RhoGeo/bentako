import React from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { setActiveStoreId, useActiveStoreId } from "@/components/lib/activeStore";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Store, Copy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";

export default function MyStores() {
  const navigate = useNavigate();
  const { storeId: activeStoreId } = useActiveStoreId();
  const { stores, memberships } = useAuth();

  const storeIdOf = (s) => s?.id || s?.store_id;

  const rows = (stores || []).map((s) => {
    const sid = storeIdOf(s);
    const m = (memberships || []).find((mm) => mm.store_id === sid) || null;
    return { ...s, __store_id: sid, role: m?.role || "" };
  });

  const handleSwitch = (storeId) => {
    setActiveStoreId(storeId);
    toast.success("Switched store.");
    navigate(createPageUrl("Counter"), { replace: true });
  };

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target">
          <ArrowLeft className="w-5 h-5 text-stone-600" />
        </button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">My Stores</h1>
      </div>

      <div className="px-4 py-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-8">No stores found.</p>
        ) : (
          rows.map((s) => {
            const sid = s.__store_id;
            const isActive = sid === activeStoreId;
            return (
              <div
                key={sid}
                className={`bg-white rounded-2xl border shadow-sm p-4 ${isActive ? "border-blue-300" : "border-stone-100"}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? "bg-blue-600" : "bg-stone-100"}`}>
                    <Store className={`w-5 h-5 ${isActive ? "text-white" : "text-stone-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-stone-800 text-sm truncate">{s.store_name || sid}</p>
                      {isActive && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="text-[11px] text-stone-400 font-mono truncate">{sid}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(sid);
                          toast.success("Store ID copied!");
                        }}
                        className="flex-shrink-0"
                      >
                        <Copy className="w-3 h-3 text-stone-300 hover:text-stone-500" />
                      </button>
                    </div>
                    {s.role && (
                      <p className="text-[11px] text-stone-400 mt-0.5 capitalize">Role: <span className="font-medium text-stone-600">{s.role}</span></p>
                    )}
                  </div>
                </div>

                {!isActive && (
                  <Button variant="outline" className="w-full mt-3 h-9 text-sm" onClick={() => handleSwitch(sid)}>
                    Switch to this Store
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
