import React, { useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ROLE_TEMPLATES, PERMISSION_LABELS, resolvePermissions } from "@/components/lib/permissions";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can } from "@/components/lib/permissions";
import { auditLog } from "@/components/lib/auditLog";
import { toast } from "sonner";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { invokeFunction } from "@/api/posyncClient";
import { syncNow } from "@/lib/sync";

const PERMISSION_GROUPS = [
  { label: "Financial", keys: ["financial_visibility", "reports_access", "reports_drilldowns"] },
  { label: "Inventory", keys: ["inventory_create_edit", "inventory_edit_price", "inventory_adjust_stock"] },
  { label: "Transactions", keys: ["transaction_void", "transaction_refund", "transaction_discount_override", "transaction_price_override"] },
  { label: "Customers", keys: ["customers_view", "customers_record_payment", "customers_export"] },
  { label: "Admin", keys: ["staff_manage", "permissions_manage", "devices_manage"] },
  { label: "Affiliate & Payouts", keys: ["affiliate_invite", "referral_apply_code", "payouts_view", "payouts_request"] },
];

export default function Permissions() {
  const navigate = useNavigate();
  const { storeId } = useActiveStoreId();
  const { staffMember, user } = useCurrentStaff(storeId);
  const { rawSettings } = useStoreSettings(storeId);
  const canManage = can(staffMember, "permissions_manage");

  const parseMaybeJson = (v) => {
    if (!v) return null;
    if (typeof v === "object") return v;
    try { return JSON.parse(v); } catch (_e) { return null; }
  };

  const savedManager = parseMaybeJson(rawSettings?.role_permissions_manager_json);
  const savedCashier = parseMaybeJson(rawSettings?.role_permissions_cashier_json);

  // Local editable state for role templates (owner is fixed, not editable)
  const [templates, setTemplates] = useState({
    manager: { ...ROLE_TEMPLATES.manager, ...(savedManager || {}) },
    cashier: { ...ROLE_TEMPLATES.cashier, ...(savedCashier || {}) },
  });

  const togglePerm = (role, key) => {
    setTemplates(prev => ({ ...prev, [role]: { ...prev[role], [key]: !prev[role][key] } }));
  };

  const resetRole = async (role) => {
    setTemplates(prev => ({ ...prev, [role]: { ...ROLE_TEMPLATES[role] } }));
    await auditLog("permissions_updated", `Permissions reset to defaults for role: ${role}`, { actor_email: user?.email, metadata: { role, store_id: storeId } });
    toast.success(`${role} permissions reset to defaults.`);
  };

  const saveRole = async (role) => {
    if (!storeId) { toast.error("No active store."); return; }
    const changedKeys = Object.keys(templates[role]).filter(k => templates[role][k] !== ROLE_TEMPLATES[role][k]);
    const patch = role === "manager"
      ? { role_permissions_manager_json: templates.manager }
      : { role_permissions_cashier_json: templates.cashier };

    await invokeFunction("updateStorePermissions", {
      store_id: storeId,
      ...patch,
    });

    // Pull store_settings into Dexie/local_meta
    try { await syncNow(storeId); } catch (_e) {}

    await auditLog("permissions_updated", `Permissions updated for role: ${role}`, { actor_email: user?.email, metadata: { role, changed_keys: changedKeys, store_id: storeId } });
    toast.success(`${role} permissions saved.`);
  };

  const RoleTab = ({ role, readOnly }) => {
    const perms = role === "owner" ? ROLE_TEMPLATES.owner : templates[role];
    return (
      <div className="space-y-5 pt-4">
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => resetRole(role)}>
              <RotateCcw className="w-3 h-3 mr-1" />Reset Defaults
            </Button>
            <Button size="sm" className="h-8 bg-blue-600 text-white" onClick={() => saveRole(role)}>
              Save Changes
            </Button>
          </div>
        )}
        {PERMISSION_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">{group.label}</p>
            <div className="bg-white rounded-xl border border-stone-100">
              {group.keys.map((key, i) => {
                const meta = PERMISSION_LABELS[key];
                return (
                  <div key={key} className={`flex items-start justify-between px-4 py-3 ${i < group.keys.length - 1 ? "border-b border-stone-50" : ""}`}>
                    <div className="flex-1 mr-3">
                      <p className="text-sm font-medium text-stone-700">{meta?.label || key}</p>
                      <p className="text-[11px] text-stone-400">{meta?.desc}</p>
                    </div>
                    <Switch
                      checked={!!perms[key]}
                      onCheckedChange={() => !readOnly && canManage && togglePerm(role, key)}
                      disabled={readOnly || !canManage}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800">Permissions</h1>
      </div>

      {!canManage && (
        <div className="mx-4 mt-4 bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-xs text-stone-500">
          Read-only view. Owner/Manager with permissions_manage needed to edit.
        </div>
      )}

      <div className="px-4 py-4">
        <Tabs defaultValue="manager">
          <TabsList className="w-full">
            <TabsTrigger value="owner" className="flex-1">Owner</TabsTrigger>
            <TabsTrigger value="manager" className="flex-1">Manager</TabsTrigger>
            <TabsTrigger value="cashier" className="flex-1">Cashier</TabsTrigger>
          </TabsList>
          <TabsContent value="owner"><RoleTab role="owner" readOnly /></TabsContent>
          <TabsContent value="manager"><RoleTab role="manager" readOnly={!canManage} /></TabsContent>
          <TabsContent value="cashier"><RoleTab role="cashier" readOnly={!canManage} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}