import { resolvePermissions } from "./permissions.ts";
import { verifyOwnerPinProof } from "./pin.ts";
import { getStoreSettings } from "./storeSettings.ts";

function parseMaybeJson(v: any): Record<string, boolean> | null {
  if (!v) return null;
  if (typeof v === "object") return v as any;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return typeof parsed === "object" && parsed ? (parsed as any) : null;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

async function resolveEffectivePermissions(base44: any, store_id: string, staff: any) {
  const settings = await getStoreSettings(base44, store_id);
  const role = staff.role;

  // Store-level role templates (optional)
  let storeRoleOverrides: Record<string, boolean> | null = null;
  if (role === "manager") storeRoleOverrides = parseMaybeJson(settings?.role_permissions_manager_json);
  if (role === "cashier") storeRoleOverrides = parseMaybeJson(settings?.role_permissions_cashier_json);

  // Base template -> store role overrides -> per-user overrides
  const base = resolvePermissions(role, {});
  return { ...base, ...(storeRoleOverrides || {}), ...(staff.overrides_json || {}) };
}

export function requirePermission(staff: any, permission: string) {
  // Default (non-store-templated) permissions for fast checks.
  const perms = resolvePermissions(staff.role, staff.overrides_json || {});
  if (!perms[permission]) {
    throw Object.assign(new Error(`Missing permission: ${permission}`), { code: "FORBIDDEN" });
  }
}

export async function requirePermissionOrOwnerPin(base44: any, staff: any, args: { store_id: string; permission: string; pinSettingField: string; owner_pin_proof?: string | null }) {
  const perms = await resolveEffectivePermissions(base44, args.store_id, staff);
  if (perms[args.permission]) return;

  const settings = await getStoreSettings(base44, args.store_id);
  const requirePin = !!settings?.[args.pinSettingField];
  if (!requirePin) {
    throw Object.assign(new Error(`Missing permission: ${args.permission}`), { code: "FORBIDDEN" });
  }
  const ok = await verifyOwnerPinProof(base44, args.store_id, args.owner_pin_proof);
  if (!ok) {
    throw Object.assign(new Error("Owner PIN required"), { code: "PIN_REQUIRED" });
  }
}
