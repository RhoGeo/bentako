import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";
import { logActivityEvent } from "./_lib/activity.ts";

function toCsvRow(values: string[]) {
  const esc = (s: string) => {
    const v = s ?? "";
    if (/[\",\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
    return v;
  };
  return values.map(esc).join(",");
}

/**
 * exportCustomers — Step 11 PIN gate for data export.
 * Returns CSV string in JSON to keep response shape consistent.
 */
export async function exportCustomers(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id, owner_pin_proof } = body || {};
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "customers_export",
      pinSettingField: "pin_required_export",
      owner_pin_proof,
    });

    const customers = await base44.asServiceRole.entities.Customer.filter({ store_id });
    const rows: string[] = [];
    rows.push(toCsvRow(["customer_id", "name", "phone", "balance_due_centavos", "last_transaction_date"]));
    for (const c of customers || []) {
      rows.push(toCsvRow([
        String(c.id || c.customer_id || ""),
        String(c.name || ""),
        String(c.phone || c.phone_number || ""),
        String(c.balance_due_centavos ?? 0),
        String(c.last_transaction_date || ""),
      ]));
    }
    const csv = rows.join("\n");

    await logActivityEvent(base44, {
      store_id,
      event_type: "customers_exported",
      description: `Customers exported (${customers?.length || 0})`,
      user_id: user.user_id,
      actor_email: user.email,
      metadata_json: { count: customers?.length || 0 },
    });

    return jsonOk({ csv, count: customers?.length || 0 });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(exportCustomers);
