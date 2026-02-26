import React, { useState, useEffect } from "react";
import { Save, Lock, RefreshCw, AlertTriangle } from "lucide-react";
import SubpageHeader from "@/components/layout/SubpageHeader";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStoreSettings, SAFE_DEFAULTS } from "@/components/lib/useStoreSettings";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { can } from "@/components/lib/permissions";
import { auditLog } from "@/components/lib/auditLog";
import { hashPin, verifyPin } from "@/components/lib/pinVerify";
import OwnerPinModal from "@/components/global/OwnerPinModal";
import SafeDefaultsBanner from "@/components/global/SafeDefaultsBanner";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeFunction } from "@/api/posyncClient";
import { syncNow } from "@/lib/sync";

export default function StoreSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { settings, isUsingSafeDefaults, rawSettings } = useStoreSettings(storeId);
  const { staffMember, user } = useCurrentStaff(storeId);
  const isOwner = staffMember?.role === "owner";

  const [form, setForm] = useState(null);
  const [pinModal, setPinModal] = useState({ open: false, action: "" });
  const [pinChangeMode, setPinChangeMode] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        store_name: settings.store_name || "",
        address: settings.address || "",
        contact: settings.contact || "",
        pin_required_void_refund: settings.pin_required_void_refund,
        pin_required_discount_override: settings.pin_required_discount_override ?? settings.pin_required_price_discount_override,
        pin_required_price_override: settings.pin_required_price_override ?? settings.pin_required_price_discount_override,
        pin_required_stock_adjust: settings.pin_required_stock_adjust,
        pin_required_export: settings.pin_required_export,
        pin_required_device_revoke: settings.pin_required_device_revoke,
        allow_negative_stock: settings.allow_negative_stock,
        low_stock_threshold_default: settings.low_stock_threshold_default,
        auto_sync_on_reconnect: settings.auto_sync_on_reconnect,
        auto_sync_after_event: settings.auto_sync_after_event,
      });
    }
  }, [rawSettings]);

  const updateField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!isOwner) { toast.error("Owner only."); return; }
    setSaving(true);
    const existing = rawSettings;
    const changedKeys = form ? Object.keys(form).filter(k => form[k] !== (existing?.[k] ?? SAFE_DEFAULTS[k])) : [];

    await invokeFunction("updateStoreSettings", {
      store_id: storeId,
      ...form,
    });
    try { await syncNow(storeId); } catch (_e) {}
    await auditLog("store_settings_updated", `Store settings updated`, { actor_email: user?.email, metadata: { changed_keys: changedKeys } });
    queryClient.invalidateQueries({ queryKey: ["store-settings", storeId] });
    toast.success("Settings saved!");
    setSaving(false);
  };

  const handleChangePinClick = () => {
    setPinModal({ open: true, action: "Change Owner PIN" });
  };

  const handlePinModalApproved = async () => {
    setPinModal({ open: false, action: "" });
    if (!newPin || newPin.length < 4) { toast.error("New PIN must be 4–6 digits."); return; }
    if (newPin !== confirmPin) { toast.error("PINs do not match."); return; }
    const hash = await hashPin(newPin);
    await invokeFunction("setOwnerPin", { store_id: storeId, owner_pin_hash: hash });
    try { await syncNow(storeId); } catch (_e) {}
    await auditLog("store_settings_updated", "Owner PIN changed", { actor_email: user?.email, metadata: { changed_keys: ["owner_pin_hash"] } });
    queryClient.invalidateQueries({ queryKey: ["store-settings", storeId] });
    toast.success("Owner PIN updated!");
    setPinChangeMode(false);
    setOldPin(""); setNewPin(""); setConfirmPin("");
  };

  if (!form) return <div className="p-8 text-center text-stone-400 text-sm">Loading…</div>;

  const Toggle = ({ field, label, desc, disabled }) => (
    <div className={`flex items-start justify-between py-3.5 border-b border-stone-50 last:border-0 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex-1 mr-4">
        <p className="text-sm font-medium text-stone-700">{label}</p>
        {desc && <p className="text-xs text-stone-400 mt-0.5">{desc}</p>}
      </div>
      <Switch checked={!!form[field]} onCheckedChange={(v) => !disabled && updateField(field, v)} disabled={disabled} />
    </div>
  );

  return (
    <div className="pb-24">
      <SubpageHeader
        title="Store Settings"
        right={
          isOwner ? (
            <Button onClick={handleSave} disabled={saving} className="h-9 bg-white text-blue-700 hover:bg-white/90 px-4">
              <Save className="w-4 h-4 mr-1.5" />{saving ? "Saving…" : "Save"}
            </Button>
          ) : null
        }
      />

      <SafeDefaultsBanner show={isUsingSafeDefaults} />

      {!isOwner && (
        <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <p className="text-xs text-amber-700">Read-only. Owner access required to change settings.</p>
        </div>
      )}

      <div className="px-4 py-5 space-y-6">
        {/* Store Profile */}
        <section>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Store Profile</h2>
          <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-4">
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Store ID (share with staff)</Label>
              <div className="flex items-center gap-2">
                <Input value={storeId} readOnly className="h-11 font-mono text-sm bg-stone-50 text-stone-500" />
                <Button
                  variant="outline"
                  className="h-11 px-3 flex-shrink-0"
                  onClick={() => { navigator.clipboard.writeText(storeId); toast.success("Store ID copied!"); }}
                  type="button"
                >
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Store Name</Label>
              <Input value={form.store_name} onChange={(e) => updateField("store_name", e.target.value)} className="h-11" disabled={!isOwner} />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Address</Label>
              <Input value={form.address} onChange={(e) => updateField("address", e.target.value)} className="h-11" disabled={!isOwner} />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Contact</Label>
              <Input value={form.contact} onChange={(e) => updateField("contact", e.target.value)} className="h-11" inputMode="tel" disabled={!isOwner} />
            </div>
          </div>
        </section>

        {/* Security / PIN */}
        <section>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Security — Owner PIN Requirements</h2>
          <div className="bg-white rounded-xl border border-stone-100 px-4">
            <Toggle field="pin_required_void_refund" label="PIN: Void / Refund" desc="Require Owner PIN before voiding or refunding a sale." disabled={!isOwner} />
            <Toggle field="pin_required_discount_override" label="PIN: Discount Override" desc="Require PIN before applying custom discount." disabled={!isOwner} />
            <Toggle field="pin_required_price_override" label="PIN: Price Override" desc="Require PIN before overriding item price." disabled={!isOwner} />
            <Toggle field="pin_required_stock_adjust" label="PIN: Stock Adjustment" desc="Require PIN before manually adjusting stock quantities." disabled={!isOwner} />
            <Toggle field="pin_required_export" label="PIN: Export Customer Data" desc="Always require PIN before exporting customer data." disabled={!isOwner} />
            <Toggle field="pin_required_device_revoke" label="PIN: Device Revoke" desc="Require PIN before revoking a device." disabled={!isOwner} />
          </div>
          {isOwner && (
            <div className="mt-3">
              {!pinChangeMode ? (
                <Button variant="outline" className="w-full h-11 touch-target" onClick={() => setPinChangeMode(true)}>
                  <Lock className="w-4 h-4 mr-2" />Change Owner PIN
                </Button>
              ) : (
                <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-3">
                  <p className="text-sm font-semibold text-stone-700">Change Owner PIN</p>
                  <div>
                    <Label className="text-xs text-stone-400 mb-1 block">New PIN (4–6 digits)</Label>
                    <Input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} maxLength={6} className="h-11 font-mono tracking-widest text-center text-lg" />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400 mb-1 block">Confirm New PIN</Label>
                    <Input type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} maxLength={6} className="h-11 font-mono tracking-widest text-center text-lg" />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 h-10" onClick={() => setPinChangeMode(false)}>Cancel</Button>
                    <Button className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleChangePinClick}>Verify & Save</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Inventory */}
        <section>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Inventory Rules</h2>
          <div className="bg-white rounded-xl border border-stone-100 px-4">
            <Toggle field="allow_negative_stock" label="Allow Negative Stock" desc="Allow selling below zero. Default: OFF (recommended)." disabled={!isOwner} />
            <div className="py-3.5">
              <Label className="text-xs text-stone-500 mb-1.5 block">Default Low Stock Threshold</Label>
              <Input type="number" inputMode="numeric" value={form.low_stock_threshold_default} onChange={(e) => updateField("low_stock_threshold_default", parseInt(e.target.value || "5"))} className="h-11 w-28" disabled={!isOwner} />
            </div>
          </div>
        </section>

        {/* Sync */}
        <section>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Sync Preferences</h2>
          <div className="bg-white rounded-xl border border-stone-100 px-4">
            <Toggle field="auto_sync_on_reconnect" label="Auto-sync on Reconnect" desc="Automatically push queued events when internet is restored." disabled={!isOwner} />
            <Toggle field="auto_sync_after_event" label="Auto-sync after Each Event" desc="Attempt sync immediately after each queued action." disabled={!isOwner} />
          </div>
        </section>
      </div>

      <OwnerPinModal
        open={pinModal.open}
        onClose={() => setPinModal({ open: false, action: "" })}
        onApproved={handlePinModalApproved}
        actionContext={pinModal.action}
        storedHash={rawSettings?.owner_pin_hash}
        actorEmail={user?.email}
      />
    </div>
  );
}