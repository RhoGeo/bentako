import React, { useState } from "react";
import { ArrowLeft, Smartphone, ShieldOff, ShieldCheck, Pencil, Copy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { can, guard } from "@/components/lib/permissions";
import { auditLog } from "@/components/lib/auditLog";
import OwnerPinModal from "@/components/global/OwnerPinModal";
import { toast } from "sonner";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { invokeFunction } from "@/api/posyncClient";
import { syncNow } from "@/lib/sync";

export default function Devices() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { staffMember, user } = useCurrentStaff(storeId);
  const { settings, rawSettings } = useStoreSettings(storeId);
  const canManage = can(staffMember, "devices_manage");

  const [pinModal, setPinModal] = useState({ open: false, action: "", deviceId: null, targetStatus: null });
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: devices = [] } = useQuery({
    queryKey: ["devices", storeId],
    queryFn: async () => {
      const res = await invokeFunction("listDevices", { store_id: storeId });
      const payload = res?.data?.data || res?.data || res;
      const data = payload?.data || payload;
      return data?.devices || [];
    },
    initialData: [],
  });

  const handleRevokeClick = (device) => {
    const { allowed, reason } = guard(staffMember, "devices_manage");
    if (!allowed) { toast.error(reason); return; }
    if (settings.pin_required_device_revoke) {
      setPinModal({ open: true, action: `Revoke device: ${device.device_name || device.device_id}`, deviceId: device.id, targetStatus: "revoked" });
    } else {
      doStatusChange(device.id, "revoked", device.device_name || device.device_id);
    }
  };

  const handleAllowClick = (device) => {
    const { allowed, reason } = guard(staffMember, "devices_manage");
    if (!allowed) { toast.error(reason); return; }
    doStatusChange(device.id, "allowed", device.device_name || device.device_id);
  };

  const doStatusChange = async (deviceId, status, label, owner_pin_proof = null) => {
    await invokeFunction("updateDevice", { store_id: storeId, device_row_id: deviceId, status, owner_pin_proof });
    const evType = status === "revoked" ? "device_revoked" : "device_allowed";
    await auditLog(evType, `Device ${status}: ${label}`, { actor_email: user?.email, reference_id: deviceId, metadata: { status } });
    try { await syncNow(storeId); } catch (_e) {}
    queryClient.invalidateQueries({ queryKey: ["devices", storeId] });
    toast.success(`Device ${status}.`);
  };

  const handlePinApproved = async ({ owner_pin_proof }) => {
    setPinModal(prev => {
      doStatusChange(prev.deviceId, prev.targetStatus, prev.action, owner_pin_proof || null);
      return { open: false, action: "", deviceId: null, targetStatus: null };
    });
  };

  const startRename = (device) => {
    setRenamingId(device.id);
    setRenameValue(device.device_name || "");
  };

  const saveRename = async (device) => {
    await invokeFunction("updateDevice", { store_id: storeId, device_row_id: device.id, device_name: renameValue });
    await auditLog("device_renamed", `Device renamed to: ${renameValue}`, { actor_email: user?.email, reference_id: device.id });
    try { await syncNow(storeId); } catch (_e) {}
    queryClient.invalidateQueries({ queryKey: ["devices", storeId] });
    setRenamingId(null);
    toast.success("Device renamed.");
  };

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800">Devices</h1>
      </div>

      <div className="px-4 py-5 space-y-3">
        {devices.length === 0 ? (
          <div className="text-center py-12">
            <Smartphone className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-400">No registered devices.</p>
          </div>
        ) : devices.map((device) => (
          (() => {
            const status = device.status || (device.allowed === false ? "revoked" : "allowed");
            const label = device.device_name || device.name || "Unnamed Device";
            return (
          <div key={device.id} className={`bg-white rounded-xl border p-4 ${status === "revoked" ? "border-red-200 bg-red-50/30" : "border-stone-100"}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${status === "revoked" ? "bg-red-100" : "bg-emerald-100"}`}>
                <Smartphone className={`w-5 h-5 ${status === "revoked" ? "text-red-500" : "text-emerald-600"}`} />
              </div>
              <div className="flex-1 min-w-0">
                {renamingId === device.id ? (
                  <div className="flex gap-2 mb-1">
                    <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 text-sm flex-1" autoFocus />
                    <Button size="sm" className="h-8 bg-blue-600 text-white" onClick={() => saveRename(device)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setRenamingId(null)}>✕</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="font-medium text-sm text-stone-800">{label}</p>
                    {canManage && <button onClick={() => startRename(device)}><Pencil className="w-3 h-3 text-stone-400" /></button>}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-[11px] text-stone-400 font-mono truncate">{device.device_id}</p>
                  <button onClick={() => { navigator.clipboard.writeText(device.device_id); toast.success("Copied!"); }}>
                    <Copy className="w-3 h-3 text-stone-300" />
                  </button>
                </div>
                {device.last_seen_at && (
                  <p className="text-[11px] text-stone-400">Last seen: {new Date(device.last_seen_at).toLocaleString("en-PH")}</p>
                )}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0 ${status === "revoked" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                {status}
              </span>
            </div>
            {canManage && (
              <div className="flex gap-2 mt-3">
                {status === "allowed" ? (
                  <Button variant="outline" size="sm" className="h-8 text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleRevokeClick(device)}>
                    <ShieldOff className="w-3 h-3 mr-1.5" />Revoke
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="h-8 text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => handleAllowClick(device)}>
                    <ShieldCheck className="w-3 h-3 mr-1.5" />Allow Again
                  </Button>
                )}
              </div>
            )}
          </div>
            );
          })()
        ))}
      </div>

      <OwnerPinModal
        open={pinModal.open}
        onClose={() => setPinModal(p => ({ ...p, open: false }))}
        onApproved={handlePinApproved}
        actionContext={pinModal.action}
        storedHash={rawSettings?.owner_pin_hash}
        actorEmail={user?.email}
      />
    </div>
  );
}