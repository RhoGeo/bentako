import React, { useMemo, useState } from "react";
// SubpageHeader handles back navigation
import { createPageUrl } from "@/utils";
import { setActiveStoreId, useActiveStoreId } from "@/components/lib/activeStore";
import { Button } from "@/components/ui/button";
import SubpageHeader from "@/components/layout/SubpageHeader";
import { Store, Copy, Plus, Pencil, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/api/posyncClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function MyStores() {
  const queryClient = useQueryClient();
  const { storeId: activeStoreId } = useActiveStoreId();
  const { memberships, refreshAuth } = useAuth();
  const [includeArchived, setIncludeArchived] = useState(false);

  const storesQ = useQuery({
    queryKey: ["my-stores", includeArchived],
    queryFn: async () => {
      const res = await invokeFunction("listMyStores", { include_archived: includeArchived });
      const data = res?.data || {};
      return data?.stores || [];
    },
    initialData: [],
    staleTime: 15_000,
  });

  const stores = storesQ.data || [];

  const storeIdOf = (s) => s?.id || s?.store_id;

  const rows = useMemo(() => {
    return (stores || []).map((s) => {
      const sid = storeIdOf(s);
      const m = (memberships || []).find((mm) => mm.store_id === sid) || s.membership || null;
      return { ...s, __store_id: sid, role: m?.role || "" };
    });
  }, [stores, memberships]);

  const [modal, setModal] = useState({ open: false, mode: "create", store: null });
  const [name, setName] = useState("");

  const openCreate = () => {
    setName("");
    setModal({ open: true, mode: "create", store: null });
  };

  const openRename = (s) => {
    setName(s?.store_name || "");
    setModal({ open: true, mode: "rename", store: s });
  };

  const handleSwitch = (storeId) => {
    setActiveStoreId(storeId);
    toast.success("Switched store.");
    navigate(createPageUrl("Counter"), { replace: true });
  };

  const createStore = async () => {
    const store_name = name.trim();
    if (store_name.length < 2) return toast.error("Store name required.");
    try {
      const res = await invokeFunction("createStore", { store_name });
      const data = res?.data || {};
      const sid = data?.store?.id || data?.store?.store_id;
      toast.success("Store created.");
      setModal({ open: false, mode: "create", store: null });
      queryClient.invalidateQueries({ queryKey: ["my-stores"] });
      try { await refreshAuth(); } catch (_e) {}
      if (sid) handleSwitch(sid);
    } catch (e) {
      toast.error(e?.message || "Failed to create store.");
    }
  };

  const renameStore = async () => {
    const store_name = name.trim();
    const sid = modal.store?.__store_id;
    if (!sid) return;
    if (store_name.length < 2) return toast.error("Store name required.");
    try {
      await invokeFunction("updateStoreSettings", { store_id: sid, store_name });
      toast.success("Store updated.");
      setModal({ open: false, mode: "rename", store: null });
      queryClient.invalidateQueries({ queryKey: ["my-stores"] });
      try { await refreshAuth(); } catch (_e) {}
    } catch (e) {
      toast.error(e?.message || "Failed to update store.");
    }
  };

  const toggleArchive = async (s) => {
    const sid = s.__store_id;
    const isArchived = !!s.is_archived || !!s.archived_at;
    const ok = window.confirm(isArchived ? "Unarchive this store?" : "Archive this store?");
    if (!ok) return;
    try {
      await invokeFunction(isArchived ? "unarchiveStore" : "archiveStore", { store_id: sid });
      toast.success(isArchived ? "Store unarchived." : "Store archived.");
      queryClient.invalidateQueries({ queryKey: ["my-stores"] });
      try { await refreshAuth(); } catch (_e) {}
      // If current store was archived, switch away.
      if (!isArchived && sid === activeStoreId) {
        const next = rows.find((r) => r.__store_id !== sid && !(r.is_archived || r.archived_at))?.__store_id;
        if (next) handleSwitch(next);
      }
    } catch (e) {
      toast.error(e?.message || "Failed.");
    }
  };

  const deleteStore = async (s) => {
    const sid = s.__store_id;
    const ok = window.confirm("Delete this store? This is a soft-delete and can be recovered via DB support.");
    if (!ok) return;
    try {
      await invokeFunction("deleteStore", { store_id: sid, confirm_has_data: true });
      toast.success("Store deleted.");
      queryClient.invalidateQueries({ queryKey: ["my-stores"] });
      try { await refreshAuth(); } catch (_e) {}
      if (sid === activeStoreId) {
        const next = rows.find((r) => r.__store_id !== sid && !(r.is_archived || r.archived_at))?.__store_id;
        if (next) handleSwitch(next);
      }
    } catch (e) {
      // If server requires explicit confirm when store has data, prompt again.
      if (e?.status === 409) {
        const ok2 = window.confirm("This store has data (sales/products/customers). Confirm delete anyway?");
        if (!ok2) return;
        try {
          await invokeFunction("deleteStore", { store_id: sid, confirm_has_data: true });
          toast.success("Store deleted.");
          queryClient.invalidateQueries({ queryKey: ["my-stores"] });
          try { await refreshAuth(); } catch (_e2) {}
        } catch (e2) {
          toast.error(e2?.message || "Failed to delete.");
        }
        return;
      }
      toast.error(e?.message || "Failed to delete.");
    }
  };

  return (
    <div className="pb-24">
      <SubpageHeader
        title="My Stores"
        right={
          <Button onClick={openCreate} className="h-9 bg-white/10 text-white border-white/20 hover:bg-white/15" variant="outline">
            <Plus className="w-4 h-4 mr-1" />New
          </Button>
        }
      />

      <div className="px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <button
            className="text-xs text-stone-500 underline"
            onClick={() => setIncludeArchived((v) => !v)}
          >
            {includeArchived ? "Hide archived" : "Show archived"}
          </button>
          {storesQ.isLoading && <span className="text-[11px] text-stone-400">Refreshing…</span>}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-8">No stores found.</p>
        ) : (
          rows.map((s) => {
            const sid = s.__store_id;
            const isActive = sid === activeStoreId;
            const isArchived = !!s.is_archived || !!s.archived_at;
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
                      {isArchived && (
                        <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Archived</span>
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

                {s.role === "owner" && (
                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => openRename(s)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />Rename
                    </Button>
                    <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => toggleArchive(s)}>
                      <Archive className="w-3.5 h-3.5 mr-1" />{isArchived ? "Unarchive" : "Archive"}
                    </Button>
                    <Button variant="destructive" className="flex-1 h-9 text-xs" onClick={() => deleteStore(s)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <Dialog open={modal.open} onOpenChange={(open) => !open && setModal({ open: false, mode: "create", store: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{modal.mode === "create" ? "Create Store" : "Rename Store"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-stone-500 mb-1 block">Store Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" maxLength={60} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setModal({ open: false, mode: "create", store: null })}>
                Cancel
              </Button>
              <Button className="flex-1 h-10 bg-blue-600 text-white" onClick={modal.mode === "create" ? createStore : renameStore}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
