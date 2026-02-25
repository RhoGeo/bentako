import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setActiveStoreId, useActiveStoreId } from "@/components/lib/activeStore";
import { hashPin } from "@/components/lib/pinVerify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Store, Plus, Check, Copy, Users } from "lucide-react";
import { toast } from "sonner";

export default function MyStores() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId: activeStoreId } = useActiveStoreId();

  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 300_000,
  });

  const { data: memberships = [], isLoading, refetch } = useQuery({
    queryKey: ["my-memberships", user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      const mems = await base44.entities.StaffMember.filter({
        user_email: user.email,
        is_active: true,
      });
      const result = await Promise.all(
        (mems || []).map(async (m) => {
          try {
            const settings = await base44.entities.StoreSettings.filter({ store_id: m.store_id });
            return { ...m, store_name: settings?.[0]?.store_name || m.store_id, is_archived: !!settings?.[0]?.is_archived };
          } catch {
            return { ...m, store_name: m.store_id, is_archived: false };
          }
        })
      );
      return result;
    },
  });

  const [showAddStore, setShowAddStore] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreateStore = async () => {
    if (!storeName.trim()) { toast.error("Store name is required."); return; }
    if (!ownerPin || ownerPin.length < 4) { toast.error("PIN must be 4–6 digits."); return; }
    setCreating(true);

    const raw = storeName.trim().toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
    const storeId = `${raw}-${Date.now().toString(36)}`;
    const pinHash = await hashPin(ownerPin);

    await base44.entities.StoreSettings.create({
      store_id: storeId,
      store_name: storeName.trim(),
      address: storeAddress.trim(),
      owner_pin_hash: pinHash,
      pin_required_void_refund: true,
      pin_required_price_discount_override: true,
      pin_required_stock_adjust: true,
      pin_required_export: true,
      pin_required_device_revoke: true,
      pin_required_staff_manage: true,
      pin_required_store_archive: true,
      allow_negative_stock: false,
      low_stock_threshold_default: 5,
      auto_sync_on_reconnect: true,
      auto_sync_after_event: true,
    });

    await base44.entities.StaffMember.create({
      store_id: storeId,
      user_email: user.email,
      user_name: user.full_name || user.email,
      role: "owner",
      is_active: true,
      policy_acknowledged: true,
      policy_acknowledged_at: new Date().toISOString(),
    });

    setActiveStoreId(storeId);
    queryClient.invalidateQueries({ queryKey: ["my-memberships"] });
    queryClient.invalidateQueries({ queryKey: ["user-stores"] });
    setCreating(false);
    setShowAddStore(false);
    setStoreName(""); setStoreAddress(""); setOwnerPin("");
    toast.success(`"${storeName.trim()}" created! Switched to new store.`);
    refetch();
  };

  const handleSwitch = (storeId) => {
    setActiveStoreId(storeId);
    queryClient.invalidateQueries();
    toast.success("Switched store.");
    navigate(createPageUrl("Counter"), { replace: true });
  };

  const handleUnarchive = async (storeId) => {
    await base44.functions.invoke("unarchiveStore", { store_id: storeId });
    toast.success("Store unarchived.");
    queryClient.invalidateQueries({ queryKey: ["my-memberships"] });
    queryClient.invalidateQueries({ queryKey: ["user-stores"] });
    refetch();
  };

  const handleLeave = async (membership) => {
    if (!membership?.id) return;

    // Owners can only leave if there is another active owner.
    if (membership.role === "owner") {
      const owners = await base44.entities.StaffMember.filter({
        store_id: membership.store_id,
        role: "owner",
        is_active: true,
      });
      if ((owners || []).length <= 1) {
        toast.error("You are the last owner. Add another owner before leaving this store.");
        return;
      }
    }

    if (!window.confirm(`Leave store ${membership.store_name || membership.store_id}?`)) return;

    await base44.entities.StaffMember.update(membership.id, { is_active: false });
    toast.success("Left store.");

    queryClient.invalidateQueries({ queryKey: ["my-memberships"] });
    queryClient.invalidateQueries({ queryKey: ["user-stores"] });

    // If you left the active store, switch to the first remaining store
    if (membership.store_id === activeStoreId) {
      const remaining = memberships.filter((m) => m.store_id !== membership.store_id);
      if (remaining?.[0]?.store_id) setActiveStoreId(remaining[0].store_id);
      navigate(createPageUrl("Counter"), { replace: true });
    }
    refetch();
  };

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target">
          <ArrowLeft className="w-5 h-5 text-stone-600" />
        </button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">My Stores</h1>
        <Button
          onClick={() => setShowAddStore(true)}
          className="h-9 bg-blue-600 hover:bg-blue-700 px-3"
        >
          <Plus className="w-4 h-4 mr-1" /> Add Store
        </Button>
      </div>

      <div className="px-4 py-4 space-y-3">
        {isLoading ? (
          <p className="text-sm text-stone-400 text-center py-8">Loading stores…</p>
        ) : memberships.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-8">No stores found.</p>
        ) : (
          memberships.map((m) => {
            const isActive = m.store_id === activeStoreId;
            const isArchived = !!m.is_archived;
            return (
              <div
                key={m.store_id}
                className={`bg-white rounded-2xl border shadow-sm p-4 ${isActive ? "border-blue-300" : "border-stone-100"}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? "bg-blue-600" : "bg-stone-100"}`}>
                    <Store className={`w-5 h-5 ${isActive ? "text-white" : "text-stone-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-stone-800 text-sm truncate">{m.store_name}</p>
                      {isActive && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                      )}
                      {isArchived && (
                        <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Archived</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="text-[11px] text-stone-400 font-mono truncate">{m.store_id}</p>
                      <button
                        onClick={() => { navigator.clipboard.writeText(m.store_id); toast.success("Store ID copied!"); }}
                        className="flex-shrink-0"
                      >
                        <Copy className="w-3 h-3 text-stone-300 hover:text-stone-500" />
                      </button>
                    </div>
                    <p className="text-[11px] text-stone-400 mt-0.5 capitalize">Role: <span className="font-medium text-stone-600">{m.role}</span></p>
                  </div>
                </div>

                {!isActive && !isArchived && (
                  <Button
                    variant="outline"
                    className="w-full mt-3 h-9 text-sm"
                    onClick={() => handleSwitch(m.store_id)}
                  >
                    Switch to this Store
                  </Button>
                )}

                {isArchived && m.role === "owner" && (
                  <Button
                    variant="outline"
                    className="w-full mt-3 h-9 text-sm"
                    onClick={() => handleUnarchive(m.store_id)}
                  >
                    Unarchive Store
                  </Button>
                )}

                <Button
                  variant="ghost"
                  className="w-full mt-2 h-9 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => handleLeave(m)}
                >
                  Leave this store
                </Button>
              </div>
            );
          })
        )}

        {/* Add New Store Form */}
        {showAddStore && (
          <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-stone-800">New Store</h2>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Store Name *</Label>
              <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="e.g. Branch 2 - Cebu" className="h-11" />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Address (optional)</Label>
              <Input value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} placeholder="e.g. Brgy. Lahug, Cebu City" className="h-11" />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Owner PIN (4–6 digits) *</Label>
              <Input
                type="password"
                inputMode="numeric"
                value={ownerPin}
                onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
                className="h-11 font-mono tracking-widest text-center text-lg"
                maxLength={6}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => { setShowAddStore(false); setStoreName(""); setStoreAddress(""); setOwnerPin(""); }}>
                Cancel
              </Button>
              <Button className="flex-1 h-10 bg-blue-600 hover:bg-blue-700" onClick={handleCreateStore} disabled={creating}>
                {creating ? "Creating…" : "Create Store"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}