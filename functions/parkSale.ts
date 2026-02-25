import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { startIdempotentOperation, markIdempotentApplied } from "./_lib/idempotency.ts";

export async function parkSale(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    const store_id = body?.store_id;
    const client_tx_id = body?.client_tx_id;
    const device_id = body?.device_id;
    const sale = body?.sale;
    if (!store_id || !client_tx_id || !sale) {
      return jsonFail(400, "BAD_REQUEST", "store_id, client_tx_id, sale required");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "transaction_complete");

    const { record, duplicateApplied, appliedResult } = await startIdempotentOperation(
      base44,
      store_id,
      "parkSale",
      client_tx_id,
      { device_id }
    );
    if (duplicateApplied && appliedResult) return jsonOk(appliedResult);

    const existing = await base44.asServiceRole.entities.Sale.filter({ store_id, client_tx_id });
    if (existing?.length) {
      const result = { sale_id: existing[0].id };
      await markIdempotentApplied(base44, record.id, result);
      return jsonOk(result);
    }

    const saleRow = await base44.asServiceRole.entities.Sale.create({
      store_id,
      client_tx_id,
      device_id: device_id || null,
      cashier_email: user.email,
      cashier_name: user.full_name || "",
      status: "parked",
      sale_type: sale?.sale_type || "counter",
      items: sale?.items || [],
      notes: sale?.notes || "",
      sale_date: new Date().toISOString(),
      is_synced: true,
    });

    const result = { sale_id: saleRow.id };
    await markIdempotentApplied(base44, record.id, result);
    return jsonOk(result);
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(parkSale);
