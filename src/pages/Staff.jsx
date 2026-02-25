import React, { useState } from "react";
import { ArrowLeft, UserCog, Plus, ChevronRight, ShieldCheck, Shield } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can, guard, PERMISSION_LABELS } from "@/components/lib/permissions";
import { auditLog } from "@/components/lib/auditLog";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { invokeFunction } from "@/api/posyncClient";
import { syncNow } from "@/lib/sync";

const ROLE_BADGE = { owner: "bg-yellow-100 text-yellow-800", manager: "bg-blue-100 text-blue-800", cashier: "bg-stone-100 text-stone-600" };

export default function Staff() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { staffMember, user } = useCurrentStaff(storeId);
  const canManage = can(staffMember, "staff_manage");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ user_email: "", user_name: "", role: "cashier" });
  const [saving, setSaving] = useState(false);
  const [permModal, setPermModal] = useState({ open: false, member: null, overrides: {} });

  const { data: staffList = [] } = useQuery({
    queryKey: ["staff-list", storeId],
    queryFn: async () => {
      const res = await invokeFunction("listStoreMembers", { store_id: storeId });
      const payload = res?.data?.data || res?.data || res;
      const data = payload?.data || payload;
      return data?.members || [];
    },
    initialData: [],
  });

  const handleAdd = async () => {
    if (!addForm.user_email.trim()) { toast.error("Email required."); return; }
    setSaving(true);
    try {
      await invokeFunction("addStaffByEmail", {
        store_id: storeId,
        user_email: addForm.user_email,
        role: addForm.role,
      });
      await auditLog("member_added", `Staff added: ${addForm.user_email} as ${addForm.role}`, { actor_email: user?.email, metadata: { new_role: addForm.role, target_email: addForm.user_email } });
      try { await syncNow(storeId); } catch (_e) {}
    } catch (e) {
      toast.error(e?.message || "Failed to add staff. User must sign up first.");
      setSaving(false);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["staff-list", storeId] });
    toast.success("Staff member added!");
    setShowAdd(false);
    setAddForm({ user_email: "", user_name: "", role: "cashier" });
    setSaving(false);
  };

  const handleDeactivate = async (member) => {
    await invokeFunction("updateStoreMember", { store_id: storeId, membership_id: member.id, is_active: false });
    await auditLog("member_updated", `Staff deactivated: ${member.user_email}`, { actor_email: user?.email, metadata: { target_email: member.user_email } });
    try { await syncNow(storeId); } catch (_e) {}
    queryClient.invalidateQueries({ queryKey: ["staff-list", storeId] });
    toast.success("Staff member removed.");
  };

  const openOverrides = (member) => {
    setPermModal({ open: true, member, overrides: { ...(member?.overrides_json || {}) } });
  };

  const saveOverrides = async () => {
    const member = permModal.member;
    if (!member) return;
    await invokeFunction("updateStoreMember", {
      store_id: storeId,
      membership_id: member.id,
      overrides_json: permModal.overrides,
    });
    await auditLog("member_updated", `Overrides updated: ${member.user_email}`, { actor_email: user?.email, metadata: { target_email: member.user_email } });
    try { await syncNow(storeId); } catch (_e) {}
    queryClient.invalidateQueries({ queryKey: ["staff-list", storeId] });
    toast.success("Overrides saved.");
    setPermModal({ open: false, member: null, overrides: {} });
  };

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">Staff & Roles</h1>
        {canManage && (
          <Button onClick={() => setShowAdd(!showAdd)} className="h-9 bg-blue-600 hover:bg-blue-700 px-3">
            <Plus className="w-4 h-4 mr-1" />Add
          </Button>
        )}
      </div>

      <div className="px-4 py-5 space-y-4">
        {!canManage && (
          <div className="bg-stone-50 rounded-xl px-4 py-3 text-xs text-stone-500 flex items-center gap-2">
            <Shield className="w-4 h-4" /> Read-only — {guard(staffMember, "staff_manage").reason}
          </div>
        )}

        {showAdd && canManage && (
          <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-3">
            <p className="text-sm font-semibold text-stone-800">Add Staff Member</p>
            <div>
              <Label className="text-xs text-stone-500 mb-1 block">Email</Label>
              <Input value={addForm.user_email} onChange={(e) => setAddForm(f => ({ ...f, user_email: e.target.value }))} className="h-11" inputMode="email" autoCapitalize="none" />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1 block">Display Name</Label>
              <Input value={addForm.user_name} onChange={(e) => setAddForm(f => ({ ...f, user_name: e.target.value }))} className="h-11" />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1 block">Role</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="cashier">Cashier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button className="flex-1 h-10 bg-blue-600 text-white" onClick={handleAdd} disabled={saving}>
                {saving ? "Saving…" : "Add"}
              </Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {staffList.length === 0 ? (
            <div className="text-center py-10 text-stone-400 text-sm">
              <UserCog className="w-8 h-8 mx-auto mb-2 text-stone-300" />
              No staff yet.
            </div>
          ) : staffList.map((member, i) => (
            <div key={member.id} className={`flex items-center gap-3 px-4 py-3.5 ${i < staffList.length - 1 ? "border-b border-stone-50" : ""}`}>
              <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-stone-500">
                {(member.user_name || member.user_email)[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-800 truncate">{member.user_name || member.user_email}</p>
                <p className="text-[11px] text-stone-400 truncate">{member.user_email}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${ROLE_BADGE[member.role]}`}>
                {member.role}
              </span>
              {canManage && member.user_email !== user?.email && (
                <button onClick={() => handleDeactivate(member)} className="text-xs text-red-400 hover:text-red-600 ml-1">Remove</button>
              )}
              {canManage && member.user_email !== user?.email && (
                <button onClick={() => openOverrides(member)} className="text-xs text-stone-400 hover:text-stone-600 ml-2">Overrides</button>
              )}
            </div>
          ))}
        </div>

        <Link to={createPageUrl("Permissions")}>
          <div className="flex items-center gap-3 bg-white rounded-xl border border-stone-100 px-4 py-3.5 mt-2">
            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-purple-500" />
            </div>
            <span className="text-sm font-medium text-stone-700 flex-1">Configure Permissions</span>
            <ChevronRight className="w-4 h-4 text-stone-300" />
          </div>
        </Link>
      </div>

      <Dialog
        open={permModal.open}
        onOpenChange={(open) => !open && setPermModal({ open: false, member: null, overrides: {} })}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Member Overrides</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-stone-500">
            Overrides apply on top of role defaults. Turn ON only what you want to explicitly allow.
          </p>
          <div className="mt-3 space-y-2 max-h-[60vh] overflow-y-auto">
            {Object.entries(PERMISSION_LABELS).map(([key, meta]) => (
              <div key={key} className="flex items-start justify-between gap-3 border-b border-stone-50 pb-2">
                <div className="flex-1">
                  <div className="text-sm font-medium text-stone-800">{meta.label}</div>
                  <div className="text-[11px] text-stone-500">{meta.desc}</div>
                </div>
                <Switch
                  checked={permModal.overrides[key] === true}
                  onCheckedChange={(v) =>
                    setPermModal((p) => ({ ...p, overrides: { ...p.overrides, [key]: !!v } }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setPermModal({ open: false, member: null, overrides: {} })}>
              Cancel
            </Button>
            <Button className="flex-1 bg-blue-600 text-white" onClick={saveOverrides}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}