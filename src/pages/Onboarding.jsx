import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { setActiveStoreId } from "@/components/lib/activeStore";
import { hashPin } from "@/components/lib/pinVerify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store, Users, ArrowLeft, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState("choose"); // choose | create-store | join-staff | done
  const [loading, setLoading] = useState(false);

  // Create store form
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [ownerPin, setOwnerPin] = useState("");

  // Join staff form
  const [staffStoreId, setStaffStoreId] = useState("");

  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 300_000,
  });

  const handleCreateStore = async () => {
    if (!storeName.trim()) { toast.error("Store name is required."); return; }
    if (!ownerPin || ownerPin.length < 4) { toast.error("PIN must be 4–6 digits."); return; }
    setLoading(true);

    // Generate a unique store ID from store name + timestamp
    const raw = storeName.trim().toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
    const storeId = `${raw}-${Date.now().toString(36)}`;

    const pinHash = await hashPin(ownerPin);

    // Create StoreSettings record (this is the source of truth for store data)
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
      allow_negative_stock: false,
      low_stock_threshold_default: 5,
      auto_sync_on_reconnect: true,
      auto_sync_after_event: true,
    });

    // Register owner as StaffMember
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
    setLoading(false);
    setStep("done");
  };

  const handleJoinAsStaff = async () => {
    if (!staffStoreId.trim()) { toast.error("Please enter a Store ID."); return; }
    setLoading(true);

    // Check the store exists
    const settings = await base44.entities.StoreSettings.filter({ store_id: staffStoreId.trim() });
    if (!settings || settings.length === 0) {
      toast.error("Store not found. Check the Store ID and try again.");
      setLoading(false);
      return;
    }

    if (settings?.[0]?.is_archived) {
      toast.error("This store is archived. Ask the owner to unarchive it.");
      setLoading(false);
      return;
    }

    // Check if already a member
    const existing = await base44.entities.StaffMember.filter({
      store_id: staffStoreId.trim(),
      user_email: user.email,
    });

    if (existing && existing.length > 0) {
      // Already a member — just activate
      if (!existing[0].is_active) {
        await base44.entities.StaffMember.update(existing[0].id, { is_active: true });
      }
    } else {
      // Create pending staff record (owner will set role)
      await base44.entities.StaffMember.create({
        store_id: staffStoreId.trim(),
        user_email: user.email,
        user_name: user.full_name || user.email,
        role: "cashier",
        is_active: true,
        policy_acknowledged: false,
      });
    }

    setActiveStoreId(staffStoreId.trim());
    setLoading(false);
    setStep("done");
  };

  if (step === "done") {
    return (
      <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-2">You're all set!</h1>
          <p className="text-sm text-stone-500 mb-6">Your store is ready. Let's start selling.</p>
          <Button
            className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
            onClick={() => navigate(createPageUrl("Counter"), { replace: true })}
          >
            Go to Counter
          </Button>
        </div>
      </div>
    );
  }

  if (step === "create-store") {
    return (
      <div className="min-h-[100dvh] bg-stone-50 px-4 py-8">
        <div className="max-w-sm mx-auto">
          <button onClick={() => setStep("choose")} className="flex items-center gap-2 text-sm text-stone-500 mb-6">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-4">
            <Store className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-1">Create Your Store</h1>
          <p className="text-sm text-stone-500 mb-6">Set up your sari-sari store to get started.</p>

          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Store Name *</Label>
              <Input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Nanay's Sari-Sari"
                className="h-12"
                maxLength={60}
              />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Address (optional)</Label>
              <Input
                value={storeAddress}
                onChange={(e) => setStoreAddress(e.target.value)}
                placeholder="e.g. Brgy. San Jose, Cebu"
                className="h-12"
              />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Owner PIN (4–6 digits) *</Label>
              <Input
                type="password"
                inputMode="numeric"
                value={ownerPin}
                onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
                className="h-12 font-mono tracking-widest text-center text-lg"
                maxLength={6}
              />
              <p className="text-[11px] text-stone-400 mt-1">Used to protect sensitive actions like voiding sales.</p>
            </div>
          </div>

          <Button
            className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl mt-4"
            onClick={handleCreateStore}
            disabled={loading}
          >
            {loading ? "Creating…" : "Create Store"}
          </Button>
        </div>
      </div>
    );
  }

  if (step === "join-staff") {
    return (
      <div className="min-h-[100dvh] bg-stone-50 px-4 py-8">
        <div className="max-w-sm mx-auto">
          <button onClick={() => setStep("choose")} className="flex items-center gap-2 text-sm text-stone-500 mb-6">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center mb-4">
            <Users className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-1">Join a Store</h1>
          <p className="text-sm text-stone-500 mb-6">Ask your store owner for the Store ID and enter it below.</p>

          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
            <Label className="text-xs text-stone-500 mb-1.5 block">Store ID *</Label>
            <Input
              value={staffStoreId}
              onChange={(e) => setStaffStoreId(e.target.value.trim())}
              placeholder="e.g. nanay-store-abc123"
              className="h-12 font-mono"
            />
            <p className="text-[11px] text-stone-400 mt-2">The store owner can find this ID in Store Settings → Store Profile.</p>
          </div>

          <Button
            className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl mt-4"
            onClick={handleJoinAsStaff}
            disabled={loading}
          >
            {loading ? "Joining…" : "Join Store"}
          </Button>
        </div>
      </div>
    );
  }

  // Default: choose screen
  return (
    <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <Store className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-stone-800">Welcome to POSync</h1>
          <p className="text-sm text-stone-500 mt-2">How would you like to get started?</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setStep("create-store")}
            className="w-full bg-white rounded-2xl border border-stone-200 p-5 text-left hover:border-blue-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Store className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-stone-800">I'm a Store Owner</p>
                <p className="text-xs text-stone-500 mt-0.5">Set up a new store for your business.</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setStep("join-staff")}
            className="w-full bg-white rounded-2xl border border-stone-200 p-5 text-left hover:border-indigo-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <p className="font-semibold text-stone-800">I'm a Staff Member</p>
                <p className="text-xs text-stone-500 mt-0.5">Join an existing store using a Store ID.</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}