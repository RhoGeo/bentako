// POSync Permission System

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
    store_archive: true,
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
    store_archive: false,
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
    store_archive: false,
    affiliate_invite: false,
    referral_apply_code: false,
    payouts_view: false,
    payouts_request: false,
  },
};

export const PERMISSION_LABELS = {
  financial_visibility: { label: "Financial Visibility", desc: "See revenue/profit numbers" },
  reports_access: { label: "Reports Access", desc: "View reports tab" },
  reports_drilldowns: { label: "Reports Drilldowns", desc: "Drill into transaction details" },
  inventory_create_edit: { label: "Create/Edit Products", desc: "Add or edit product records" },
  inventory_edit_price: { label: "Edit Prices", desc: "Change selling/cost prices" },
  inventory_adjust_stock: { label: "Adjust Stock", desc: "Manually adjust stock quantities" },
  transaction_void: { label: "Void Transactions", desc: "Void completed sales" },
  transaction_refund: { label: "Refund Transactions", desc: "Process refunds" },
  transaction_discount_override: { label: "Discount Override", desc: "Apply non-standard discounts" },
  transaction_price_override: { label: "Price Override", desc: "Override product prices at counter" },
  customers_view: { label: "View Customers", desc: "See customer list and balances" },
  customers_record_payment: { label: "Record Payment", desc: "Record utang payments" },
  customers_export: { label: "Export Customers", desc: "Export customer data (PIN required)" },
  staff_manage: { label: "Manage Staff", desc: "Add/remove/edit staff members" },
  permissions_manage: { label: "Manage Permissions", desc: "Change role permissions" },
  devices_manage: { label: "Manage Devices", desc: "Rename or revoke devices" },
  store_archive: { label: "Archive Store", desc: "Archive/unarchive a store" },
  affiliate_invite: { label: "Invite Affiliates", desc: "Send affiliate invitations" },
  referral_apply_code: { label: "Apply Referral Code", desc: "Apply partner referral code (once)" },
  payouts_view: { label: "View Payouts", desc: "See payout history and balance" },
  payouts_request: { label: "Request Payout", desc: "Submit payout requests" },
};

export function resolvePermissions(role, overrides = {}) {
  const base = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.cashier;
  return { ...base, ...overrides };
}

export function can(staffMember, permission) {
  if (!staffMember) return false;
  const perms = resolvePermissions(staffMember.role, staffMember.overrides_json || {});
  return !!perms[permission];
}

export function guard(staffMember, permission) {
  const allowed = can(staffMember, permission);
  if (!allowed) {
    return {
      allowed: false,
      reason: `Walang pahintulot. Kailangan ng "${PERMISSION_LABELS[permission]?.label || permission}" permission. Makipag-usap sa Owner.`,
    };
  }
  return { allowed: true, reason: "" };
}