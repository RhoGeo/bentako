import React, { useMemo, useState } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useStoresForUser } from "@/components/lib/useStores";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can, guard } from "@/components/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

/**
 * StaffAssignments
 * - Owner multi-store tool to assign a staff member to multiple stores in one action.
 * - Uses StaffMember entity as the authoritative membership model.
 */
export default function StaffAssignments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { stores, user } = useStoresForUser();
  const { staffMember } = useCurrentStaff(storeId);

  const canManage = can(staffMember, "staff_manage");

  const { data: myMemberships = [] } = useQuery({
    queryKey: ["my-memberships", user?.email],
    enabled: !!user?.email,
    queryFn: () => base44.entities.StaffMember.filter({ user_email: user.email, is_active: true }),
    initialData: [],
    staleTime: 60_000,
  });

  const ownerStoreIds = useMemo(
    () => myMemberships.filter((m) => m.role === "owner").map((m) => m.store_id),
    [myMemberships]
  );

  const ownerStores = useMemo(() => {
    const set = new Set(ownerStoreIds);
    return (stores || []).filter((s) => set.has(s.store_id));
  }, [stores, ownerStoreIds]);

  const [form, setForm] = useState({
    user_email: "",
    user_name: "",
    role: "cashier",
    storeIds: [],
  });
  const [saving, setSaving] = useState(false);

  const toggleStore = (sid) => {
    setForm((f) => {
      const set = new Set(f.storeIds);
      if (set.has(sid)) set.delete(sid);
      else set.add(sid);
      return { ...f, storeIds: Array.from(set) };
    });
  };

  const handleAssign = async () => {
    const email = form.user_email.trim().toLowerCase();
    if (!email) return toast.error("Email required.");
    if (!email.includes("@")) return toast.error("Invalid email.");
    if (form.storeIds.length === 0) return toast.error("Select at least one store.");

    setSaving(true);
    try {
      for (const sid of form.storeIds) {
        const existing = await base44.entities.StaffMember.filter({ store_id: sid, user_email: email });
        if (existing?.[0]) {
          await base44.entities.StaffMember.update(existing[0].id, {
            user_name: form.user_name || existing[0].user_name,
            role: form.role,
            is_active: true,
          });
        } else {
          await base44.entities.StaffMember.create({
            store_id: sid,
            user_email: email,
            user_name: form.user_name || email,
            role: form.role,
            is_active: true,
          });
        }
      }
      toast.success("Staff assigned.");
      queryClient.invalidateQueries({ queryKey: ["staff-list"] });
      setForm({ user_email: "", user_name: "", role: "cashier", storeIds: [] });
    } finally {
      setSaving(false);
    }
  };

  if (!canManage || staffMember?.role !== "owner") {
    return (
      <div className="pb-24">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
          <button onClick={() => navigate(-1)} className="touch-target">
            <ArrowLeft className="w-5 h-5 text-stone-600" />
          </button>
          <h1 className="text-lg font-bold text-stone-800">Staff Assignments</h1>
        </div>
        <div className="px-4 py-10 text-sm text-stone-500">
          {staffMember?.role !== "owner"
            ? "Owner only."
            : guard(staffMember, "staff_manage").reason}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target">
          <ArrowLeft className="w-5 h-5 text-stone-600" />
        </button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">Assign Staff (Multi-store)</h1>
      </div>

      <div className="px-4 py-5 space-y-4">
        <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-3">
          <p className="text-sm font-semibold text-stone-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" /> Add / Assign Staff
          </p>

          <div>
            <Label className="text-xs text-stone-500 mb-1 block">Email</Label>
            <Input
              value={form.user_email}
              onChange={(e) => setForm((f) => ({ ...f, user_email: e.target.value }))}
              className="h-11"
              inputMode="email"
              autoCapitalize="none"
            />
          </div>

          <div>
            <Label className="text-xs text-stone-500 mb-1 block">Display Name</Label>
            <Input value={form.user_name} onChange={(e) => setForm((f) => ({ ...f, user_name: e.target.value }))} className="h-11" />
          </div>

          <div>
            <Label className="text-xs text-stone-500 mb-1 block">Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="cashier">Cashier</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-stone-500 mb-2 block">Assign to Stores</Label>
            <div className="space-y-2">
              {ownerStores.map((s) => (
                <label key={s.store_id} className="flex items-center gap-2 bg-stone-50 rounded-lg px-3 py-2">
                  <Checkbox checked={form.storeIds.includes(s.store_id)} onCheckedChange={() => toggleStore(s.store_id)} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-stone-700 truncate">{s.store_name}</div>
                    <div className="text-[11px] text-stone-400 truncate">{s.store_id}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <Button className="w-full h-11 bg-indigo-600 hover:bg-indigo-700" onClick={handleAssign} disabled={saving}>
            {saving ? "Saving…" : "Assign Staff"}
          </Button>
        </div>

        <div className="text-xs text-stone-500">
          Tip: Use invites (Staff & Roles page) for self-service joining.
        </div>
      </div>
    </div>
  );
}
