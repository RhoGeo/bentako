import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";
import { startIdempotentOperation, markIdempotentApplied } from "./_lib/idempotency.ts";
import { applyStockDeltaWithLedger, ADJUSTMENT_REASONS } from "./_lib/stockAtomic.ts";
import { logActivityEvent } from "./_lib/activity.ts";

export async function adjustStock(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    const { store_id, product_id, delta_qty, reason, adjustment_id, device_id, owner_pin_proof } = body || {};
    if (!store_id || !product_id || delta_qty === undefined || !reason || !adjustment_id) {
      return jsonFail(400, "BAD_REQUEST", "store_id, product_id, delta_qty, reason, adjustment_id required");
    }
    if (!ADJUSTMENT_REASONS.includes(reason)) {
      return jsonFail(400, "BAD_REQUEST", `Invalid reason: ${reason}`);
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "inventory_adjust_stock",
      pinSettingField: "pin_required_stock_adjust",
      owner_pin_proof,
    });

    const { record, duplicateApplied, appliedResult } = await startIdempotentOperation(
      base44,
      store_id,
      "adjustStock",
      adjustment_id,
      { product_id }
    );
    if (duplicateApplied && appliedResult) return jsonOk(appliedResult);

    const res = await applyStockDeltaWithLedger(base44, {
      store_id,
      product_id,
      delta_qty: Number(delta_qty),
      reason,
      reference_type: "adjustment",
      reference_id: adjustment_id,
      device_id: device_id || null,
      client_tx_id: null,
      created_at_device: Date.now(),
    });

    const result = { product_id, new_qty: res.new_qty };
    await markIdempotentApplied(base44, record.id, result);

    await logActivityEvent(base44, {
      store_id,
      event_type: "stock_adjusted",
      description: `Stock adjusted (${reason})`,
      entity_id: product_id,
      user_id: user.user_id,
      actor_email: user.email,
      device_id: device_id || null,
      metadata_json: { delta_qty: Number(delta_qty), reason, adjustment_id },
    });

    return jsonOk(result);
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(adjustStock);
