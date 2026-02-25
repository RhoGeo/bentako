// Minimal permission enforcement for server functions.
// Mirrors client-side ROLE_TEMPLATES keys used by spec.

export const ROLE_TEMPLATES: Record<string, Record<string, boolean>> = {
  owner: {
    inventory_adjust_stock: true,
    transaction_void: true,
    transaction_refund: true,
    reports_access: true,
    reports_drilldowns: true,
    customers_record_payment: true,
    affiliate_invite: true,
    referral_apply_code: true,
  },
  manager: {
    inventory_adjust_stock: true,
    transaction_void: false,
    transaction_refund: false,
    reports_access: true,
    reports_drilldowns: false,
    customers_record_payment: true,
    affiliate_invite: true,
    referral_apply_code: false,
  },
  cashier: {
    inventory_adjust_stock: false,
    transaction_void: false,
    transaction_refund: false,
    reports_access: false,
    reports_drilldowns: false,
    customers_record_payment: false,
    affiliate_invite: false,
    referral_apply_code: false,
  },
};

function resolvePermissions(role: string, overrides: Record<string, unknown> | null | undefined) {
  const base = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.cashier;
  const o = (overrides && typeof overrides === "object") ? overrides : {};
  const merged: Record<string, boolean> = { ...base };
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "boolean") merged[k] = v;
  }
  return merged;
}

async function loadStoreRoleTemplates(base44: any, store_id: string) {
  try {
    const settings = await base44.asServiceRole.entities.StoreSettings.filter({ store_id });
    const s = settings?.[0];
    const templates = s?.role_permissions_json;
    if (templates && typeof templates === "object") return templates;
  } catch (_e) {}
  return null;
}

export async function getStaffMember(base44: any, store_id: string, user: any) {
  if (!user?.email) return null;
  // Prefer StoreMembership if available.
  try {
    const memberships = await base44.asServiceRole.entities.StoreMembership.filter({
      store_id,
      user_email: user.email,
      is_active: true,
    });
    if (memberships?.[0]) {
      // Map membership roles to app roles (owner/manager/cashier).
      const role = String(memberships[0].role || memberships[0].store_role || "cashier").toLowerCase();
      return {
        role: role === "owner" ? "owner" : role === "manager" ? "manager" : "cashier",
        overrides_json: memberships[0].overrides_json || {},
        store_id,
        user_email: user.email,
        user_name: user.full_name,
      };
    }
  } catch (_e) {
    // ignore
  }
  try {
    const staff = await base44.asServiceRole.entities.StaffMember.filter({
      store_id,
      user_email: user.email,
      is_active: true,
    });
    if (staff?.[0]) return staff[0];
  } catch (_e) {
    // entity may not exist
  }
  // Admins default to owner (matches client behavior)
  if (user?.role === "admin") {
    return { role: "owner", overrides_json: {}, store_id, user_email: user.email, user_name: user.full_name };
  }
  return null;
}

export async function requireStoreAccess(base44: any, store_id: string, user: any) {
  const staff = await getStaffMember(base44, store_id, user);
  if (!staff) return { ok: false, error: { code: "FORBIDDEN", message: "No store access" } };
  return { ok: true, staff };
}

export async function requirePermission(base44: any, store_id: string, user: any, permissionKey: string) {
  const access = await requireStoreAccess(base44, store_id, user);
  if (!access.ok) return access;
  const storeTemplates = await loadStoreRoleTemplates(base44, store_id);
  const storeRole = storeTemplates?.[access.staff.role];
  const perms = resolvePermissions(access.staff.role, {
    ...(storeRole && typeof storeRole === "object" ? storeRole : {}),
    ...(access.staff.overrides_json || {}),
  });
  if (!perms[permissionKey]) {
    return { ok: false, error: { code: "FORBIDDEN", message: `Missing permission: ${permissionKey}` } };
  }
  return access;
}
