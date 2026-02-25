// POSync Permission System (Edge Functions)
// Mirrors frontend permissions in src/components/lib/permissions.jsx

export const ROLE_TEMPLATES = {
  owner: {
    financial_visibility: true,
    reports_access: true,
    reports_drilldowns: true,
    inventory_create_edit: true,
    inventory_edit_price: true,
    inventory_adjust_stock: true,
    transaction_void: true,
    transaction_refund: true,
    transaction_discount_override: true,
    transaction_price_override: true,
    customers_view: true,
    customers_record_payment: true,
    customers_export: true,
    staff_manage: true,
    permissions_manage: true,
    devices_manage: true,
    affiliate_invite: true,
    referral_apply_code: true,
    payouts_view: true,
    payouts_request: true,
  },
  manager: {
    financial_visibility: true,
    reports_access: true,
    reports_drilldowns: false,
    inventory_create_edit: true,
    inventory_edit_price: false,
    inventory_adjust_stock: true,
    transaction_void: false,
    transaction_refund: false,
    transaction_discount_override: false,
    transaction_price_override: false,
    customers_view: true,
    customers_record_payment: true,
    customers_export: false,
    staff_manage: false,
    permissions_manage: false,
    devices_manage: false,
    affiliate_invite: false,
    referral_apply_code: false,
    payouts_view: true,
    payouts_request: false,
  },
  cashier: {
    financial_visibility: false,
    reports_access: false,
    reports_drilldowns: false,
    inventory_create_edit: false,
    inventory_edit_price: false,
    inventory_adjust_stock: false,
    transaction_void: false,
    transaction_refund: false,
    transaction_discount_override: false,
    transaction_price_override: false,
    customers_view: true,
    customers_record_payment: false,
    customers_export: false,
    staff_manage: false,
    permissions_manage: false,
    devices_manage: false,
    affiliate_invite: false,
    referral_apply_code: false,
    payouts_view: false,
    payouts_request: false,
  },
} as const;

export type PermissionKey = keyof typeof ROLE_TEMPLATES.owner;

type JsonObj = Record<string, unknown>;

function mergeRoleOverrides(
  base: Record<PermissionKey, boolean>,
  override: unknown,
): Record<PermissionKey, boolean> {
  if (!override || typeof override !== "object") return base;
  const out: Record<PermissionKey, boolean> = { ...(base as any) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (k in out) out[k as PermissionKey] = !!v;
  }
  return out;
}

function templateFromStoreSettings(args: { role: string; store_settings_json?: JsonObj | null }) {
  const role = (args.role || "cashier").toLowerCase();
  if (role === "owner") return { ...(ROLE_TEMPLATES.owner as any) } as Record<PermissionKey, boolean>;

  const base = (role === "manager" ? ROLE_TEMPLATES.manager : ROLE_TEMPLATES.cashier) as any;
  const storeSettings = (args.store_settings_json || {}) as any;
  const overrideKey = role === "manager" ? "role_permissions_manager_json" : "role_permissions_cashier_json";
  return mergeRoleOverrides({ ...(base as any) }, storeSettings?.[overrideKey]);
}

export function resolvePermissions(args: {
  role: string;
  overrides_json?: Record<string, unknown> | null;
  store_settings_json?: Record<string, unknown> | null;
}): Record<PermissionKey, boolean> {
  const base = templateFromStoreSettings({ role: args.role, store_settings_json: args.store_settings_json || null });
  return mergeRoleOverrides(base, args.overrides_json || null);
}

export function canPermission(
  ctx: { role: string; overrides_json?: Record<string, unknown> | null; store_settings_json?: Record<string, unknown> | null },
  permission: PermissionKey,
): boolean {
  const perms = resolvePermissions(ctx);
  return !!perms[permission];
}
