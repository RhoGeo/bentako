import React, { useState } from "react";
import { ArrowLeft, UserCog, Plus, ChevronRight, ShieldCheck, Shield, Link2, Copy, XCircle } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can, guard } from "@/components/lib/permissions";
import { auditLog } from "@/components/lib/auditLog";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import { useActiveStoreId } from "@/components/lib/activeStore";

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

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ invite_email: "", role: "cashier" });
  const [inviteLink, setInviteLink] = useState("");

  const { data: staffList = [] } = useQuery({
    queryKey: ["staff-list", storeId],
    queryFn: () => base44.entities.StaffMember.filter({ store_id: storeId, is_active: true }),
    initialData: [],
  });

  const { data: invites = [] } = useQuery({
    queryKey: ["staff-invites", storeId],
    enabled: canManage && navigator.onLine,
    queryFn: async () => {
      const res = await base44.functions.invoke("listStaffInvites", { store_id: storeId });
      return res?.data?.data?.invites || res?.data?.invites || [];
    },
    initialData: [],
    staleTime: 15_000,
  });

  const handleAdd = async () => {
    if (!addForm.user_email.trim()) { toast.error("Email required."); return; }
    setSaving(true);
    await base44.entities.StaffMember.create({ ...addForm, store_id: storeId, is_active: true });
    await auditLog("member_role_changed", `Staff added: ${addForm.user_email} as ${addForm.role}`, { actor_email: user?.email, metadata: { new_role: addForm.role, target_email: addForm.user_email } });
    queryClient.invalidateQueries({ queryKey: ["staff-list", storeId] });
    toast.success("Staff member added!");
    setShowAdd(false);
    setAddForm({ user_email: "", user_name: "", role: "cashier" });
    setSaving(false);
  };

  const handleDeactivate = async (member) => {
    await base44.entities.StaffMember.update(member.id, { is_active: false });
    await auditLog("member_role_changed", `Staff deactivated: ${member.user_email}`, { actor_email: user?.email, metadata: { target_email: member.user_email } });
    queryClient.invalidateQueries({ queryKey: ["staff-list", storeId] });
    toast.success("Staff member removed.");
  };

  const handleInvite = async () => {
    if (!inviteForm.invite_email.trim()) { toast.error("Email required."); return; }
    const res = await base44.functions.invoke("inviteStaff", {
      store_id: storeId,
      invite_email: inviteForm.invite_email.trim(),
      role: inviteForm.role,
    });
    const data = res?.data?.data || res?.data;
    const token = data?.invite_token;
    if (!token) {
      toast.error(data?.error?.message || "Invite failed.");
      return;
    }
    const url = `${window.location.origin}${createPageUrl("AcceptInvite")}?token=${encodeURIComponent(token)}`;
    setInviteLink(url);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied!");
    } catch {
      toast.success("Invite created.");
    }
    queryClient.invalidateQueries({ queryKey: ["staff-invites", storeId] });
  };

  const handleRevokeInvite = async (invite_id) => {
    await base44.functions.invoke("revokeStaffInvite", { store_id: storeId, invite_id });
    toast.success("Invite revoked.");
    queryClient.invalidateQueries({ queryKey: ["staff-invites", storeId] });
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
            </div>
          ))}
        </div>

        {can(staffMember, "permissions_manage") && (
          <Link to={createPageUrl("Permissions")}>
            <div className="flex items-center gap-3 bg-white rounded-xl border border-stone-100 px-4 py-3.5 mt-2">
              <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-purple-500" />
              </div>
              <span className="text-sm font-medium text-stone-700 flex-1">Configure Permissions</span>
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </div>
          </Link>
        )}

        {/* Invites (link-based) */}
        {canManage && (
          <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-800 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-blue-600" /> Staff Invites
              </p>
              <Button variant="outline" className="h-9" onClick={() => setInviteOpen((v) => !v)}>
                {inviteOpen ? "Close" : "New Invite"}
              </Button>
            </div>

            {inviteOpen && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-stone-500 mb-1 block">Invite Email</Label>
                  <Input
                    value={inviteForm.invite_email}
                    onChange={(e) => setInviteForm((f) => ({ ...f, invite_email: e.target.value }))}
                    className="h-11"
                    inputMode="email"
                    autoCapitalize="none"
                  />
                </div>
                <div>
                  <Label className="text-xs text-stone-500 mb-1 block">Role</Label>
                  <Select value={inviteForm.role} onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v }))}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Owner</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="cashier">Cashier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full h-11 bg-blue-600 hover:bg-blue-700" onClick={handleInvite}>
                  Create Invite Link
                </Button>

                {inviteLink && (
                  <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
                    <p className="text-xs text-stone-500 mb-2">Share this link with the invited staff:</p>
                    <div className="flex items-center gap-2">
                      <Input value={inviteLink} readOnly className="h-10 font-mono text-xs bg-white" />
                      <Button
                        variant="outline"
                        className="h-10 px-3"
                        onClick={async () => {
                          await navigator.clipboard.writeText(inviteLink);
                          toast.success("Copied.");
                        }}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {invites.length > 0 && (
              <div className="pt-2">
                <p className="text-xs text-stone-500 mb-2">Pending invites</p>
                <div className="space-y-2">
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-2 bg-stone-50 border border-stone-100 rounded-xl p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-800 truncate">{inv.invite_email}</p>
                        <p className="text-[11px] text-stone-400">Role: {inv.role} · Expires: {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString("en-PH") : "—"}</p>
                      </div>
                      <button
                        className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                        onClick={() => handleRevokeInvite(inv.id)}
                        title="Revoke"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}