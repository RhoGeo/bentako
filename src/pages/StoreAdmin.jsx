import React, { useMemo, useState } from "react";
import { ArrowLeft, Layers, Settings, Users, Archive, Copy, Link2, XCircle, ChevronRight } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { setActiveStoreId, useActiveStoreId } from "@/components/lib/activeStore";
import { useStoresForUser } from "@/components/lib/useStores";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can } from "@/components/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/**
 * StoreAdmin
 * Central admin page for owners:
 * - Multi-store overview (including archived stores)
 * - Quick actions: switch, staff, settings
 * - Archive/unarchive store
 * - Invite staff + pending invites + revoke
 */
export default function StoreAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId: activeStoreId } = useActiveStoreId();
  const { stores, user, isLoading } = useStoresForUser({ includeArchived: true });
  const { staffMember } = useCurrentStaff(activeStoreId);

  // Owner-only entry point. (If you want to allow managers with permission, relax this.)
  const isOwnerHere = staffMember?.role === "owner";
  const canManageStaff = can(staffMember, "staff_manage");
  const canArchive = can(staffMember, "store_archive") || staffMember?.role === "owner";

  const { data: myMemberships = [] } = useQuery({
    queryKey: ["my-memberships", user?.email],
    enabled: !!user?.email,
    queryFn: () => base44.entities.StaffMember.filter({ user_email: user.email, is_active: true }),
    initialData: [],
    staleTime: 60_000,
  });

  const ownerStoreIds = useMemo(() => {
    return new Set(myMemberships.filter((m) => m.role === "owner").map((m) => m.store_id));
  }, [myMemberships]);

  const ownerStores = useMemo(() => {
    return (stores || []).filter((s) => ownerStoreIds.has(s.store_id));
  }, [stores, ownerStoreIds]);

  const [expandedStoreId, setExpandedStoreId] = useState(null);
  const [inviteForm, setInviteForm] = useState({ invite_email: "", role: "cashier" });
  const [inviteLink, setInviteLink] = useState("");

  const { data: expandedInvites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ["staff-invites", expandedStoreId],
    enabled: !!expandedStoreId && navigator.onLine,
    queryFn: async () => {
      const res = await base44.functions.invoke("listStaffInvites", { store_id: expandedStoreId });
      return res?.data?.data?.invites || res?.data?.invites || [];
    },
    initialData: [],
    staleTime: 15_000,
  });

  const refreshAllStores = () => {
    queryClient.invalidateQueries({ queryKey: ["user-stores"] });
    queryClient.invalidateQueries({ queryKey: ["my-memberships"] });
  };

  const handleSwitch = (sid) => {
    setActiveStoreId(sid);
    toast.success("Switched store.");
    navigate(createPageUrl("Counter"), { replace: true });
  };

  const handleArchiveToggle = async (sid, isArchived) => {
    if (!canArchive) {
      toast.error("No permission to archive.");
      return;
    }

    const confirmMsg = isArchived
      ? "Unarchive this store? It will show up in store picker again."
      : "Archive this store? It will be hidden from store picker.";
    if (!window.confirm(confirmMsg)) return;

    const fn = isArchived ? "unarchiveStore" : "archiveStore";
    const res = await base44.functions.invoke(fn, { store_id: sid });
    if (res?.data?.ok === false) {
      toast.error(res?.data?.error?.message || "Failed");
      return;
    }
    toast.success(isArchived ? "Store unarchived." : "Store archived.");
    refreshAllStores();
  };

  const handleInvite = async () => {
    const email = inviteForm.invite_email.trim();
    if (!expandedStoreId) return;
    if (!email) return toast.error("Email required.");

    const res = await base44.functions.invoke("inviteStaff", {
      store_id: expandedStoreId,
      invite_email: email,
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

    queryClient.invalidateQueries({ queryKey: ["staff-invites", expandedStoreId] });
  };

  const handleRevokeInvite = async (invite_id) => {
    if (!expandedStoreId) return;
    await base44.functions.invoke("revokeStaffInvite", { store_id: expandedStoreId, invite_id });
    toast.success("Invite revoked.");
    queryClient.invalidateQueries({ queryKey: ["staff-invites", expandedStoreId] });
  };

  if (!isOwnerHere) {
    return (
      <div className="pb-24">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
          <button onClick={() => navigate(-1)} className="touch-target">
            <ArrowLeft className="w-5 h-5 text-stone-600" />
          </button>
          <h1 className="text-lg font-bold text-stone-800">Store Admin</h1>
        </div>
        <div className="px-4 py-10 text-sm text-stone-500">Owner only.</div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target">
          <ArrowLeft className="w-5 h-5 text-stone-600" />
        </button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">Store Admin</h1>
        {canManageStaff && (
          <Link to={createPageUrl("StaffAssignments")}> 
            <Button variant="outline" className="h-9">Multi-store Staff</Button>
          </Link>
        )}
      </div>

      <div className="px-4 py-5 space-y-4">
        <div className="bg-stone-50 rounded-xl px-4 py-3 text-xs text-stone-500 flex items-center gap-2">
          <Layers className="w-4 h-4" /> Manage stores you own. Switch stores, archive/unarchive, and invite staff.
        </div>

        {isLoading ? (
          <div className="text-sm text-stone-400 text-center py-8">Loading stores…</div>
        ) : ownerStores.length === 0 ? (
          <div className="text-sm text-stone-400 text-center py-8">No owner stores found.</div>
        ) : (
          ownerStores.map((s) => {
            const isActive = s.store_id === activeStoreId;
            const isExpanded = expandedStoreId === s.store_id;
            return (
              <div key={s.store_id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${isActive ? "border-blue-300" : "border-stone-100"}`}>
                <div className="px-4 py-3.5 flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? "bg-blue-600" : "bg-stone-100"}`}>
                    <Layers className={`w-5 h-5 ${isActive ? "text-white" : "text-stone-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-stone-800 text-sm truncate">{s.store_name}</p>
                      {s.is_archived && (
                        <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Archived</span>
                      )}
                      {isActive && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="text-[11px] text-stone-400 font-mono truncate">{s.store_id}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(s.store_id);
                          toast.success("Store ID copied!");
                        }}
                        className="flex-shrink-0"
                      >
                        <Copy className="w-3 h-3 text-stone-300 hover:text-stone-500" />
                      </button>
                    </div>
                  </div>
                  <button
                    className="touch-target text-stone-400"
                    onClick={() => setExpandedStoreId((cur) => (cur === s.store_id ? null : s.store_id))}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronRight className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </button>
                </div>

                <div className="px-4 pb-4 flex flex-wrap gap-2">
                  {!s.is_archived && !isActive && (
                    <Button variant="outline" className="h-10" onClick={() => handleSwitch(s.store_id)}>
                      Switch
                    </Button>
                  )}
                  <Link to={createPageUrl("StoreSettings")} onClick={() => setActiveStoreId(s.store_id)}>
                    <Button variant="outline" className="h-10">
                      <Settings className="w-4 h-4 mr-2" /> Settings
                    </Button>
                  </Link>
                  <Link to={createPageUrl("Staff")} onClick={() => setActiveStoreId(s.store_id)}>
                    <Button variant="outline" className="h-10">
                      <Users className="w-4 h-4 mr-2" /> Staff
                    </Button>
                  </Link>

                  <Button
                    variant={s.is_archived ? "outline" : "destructive"}
                    className="h-10"
                    onClick={() => handleArchiveToggle(s.store_id, !!s.is_archived)}
                  >
                    <Archive className="w-4 h-4 mr-2" /> {s.is_archived ? "Unarchive" : "Archive"}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4">
                    <div className="bg-stone-50 border border-stone-100 rounded-xl p-4 space-y-3">
                      <p className="text-sm font-semibold text-stone-800 flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-blue-600" /> Staff Invites
                      </p>

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
                        <div className="bg-white border border-stone-200 rounded-xl p-3">
                          <p className="text-xs text-stone-500 mb-2">Share this link:</p>
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

                      <div className="pt-1">
                        <p className="text-xs text-stone-500 mb-2">Pending invites</p>
                        {invitesLoading ? (
                          <div className="text-sm text-stone-400">Loading…</div>
                        ) : expandedInvites.length === 0 ? (
                          <div className="text-sm text-stone-400">No pending invites.</div>
                        ) : (
                          <div className="space-y-2">
                            {expandedInvites.map((inv) => (
                              <div key={inv.id} className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl p-3">
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
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className="text-xs text-stone-500">
          Note: Archived stores are hidden from the normal store picker. Unarchive to make them visible again.
        </div>
      </div>
    </div>
  );
}
