import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, asErrorMessage } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";
import { startIdempotentOperation, markIdempotentApplied, markIdempotentFailed } from "./_lib/idempotency.ts";
import { applyStockDeltaWithLedger } from "./_lib/stockAtomic.ts";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const { store_id, sale_id, void_request_id, reason, owner_pin_proof } = body || {};
    if (!store_id || !sale_id || !void_request_id) {
      return jsonFail(400, "BAD_REQUEST", "store_id, sale_id, void_request_id required");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "transaction_void",
      pinSettingField: "pin_required_void_refund",
      owner_pin_proof,
    });

    const idemKey = `${sale_id}::${void_request_id}`;
    const { record, duplicateApplied, appliedResult } = await startIdempotentOperation(
      base44,
      store_id,
      "voidSale",
      idemKey,
      { sale_id }
    );
    if (duplicateApplied && appliedResult) return jsonOk(appliedResult);

    const sales = await base44.asServiceRole.entities.Sale.filter({ id: sale_id, store_id });
    const sale = sales?.[0];
    if (!sale) return jsonFail(404, "NOT_FOUND", "Sale not found");

    if (sale.status === "voided") {
      const result = { sale_id, status: "voided", idempotent: true };
      await markIdempotentApplied(base44, record.id, result);
      return jsonOk(result);
    }

    const items = Array.isArray(sale.items) ? sale.items : [];
    // restore stock for completed/due
    if (sale.status === "completed" || sale.status === "due") {
      for (const it of items) {
        await applyStockDeltaWithLedger(base44, {
          store_id,
          product_id: it.product_id,
          delta_qty: Number(it.qty || 0),
          reason: "void",
          reference_type: "void",
          reference_id: sale_id,
          device_id: sale.device_id || null,
          client_tx_id: sale.client_tx_id || null,
          created_at_device: Date.now(),
        });
      }
    }

    // reduce customer balance if due
    if (sale.status === "due" && sale.customer_id && Number(sale.balance_due_centavos || 0) > 0) {
      const customers = await base44.asServiceRole.entities.Customer.filter({ id: sale.customer_id, store_id });
      const cust = customers?.[0];
      if (cust) {
        const newBal = Math.max(0, Number(cust.balance_due_centavos || 0) - Number(sale.balance_due_centavos || 0));
        await base44.asServiceRole.entities.Customer.update(cust.id, {
          balance_due_centavos: newBal,
          last_transaction_date: new Date().toISOString(),
        });
      }
    }

    await base44.asServiceRole.entities.Sale.update(sale_id, {
      status: "voided",
      void_reason: reason || "",
      voided_at: new Date().toISOString(),
    });

    const result = { sale_id, status: "voided" };
    await markIdempotentApplied(base44, record.id, result);
    return jsonOk(result);
  } catch (err) {
    // best-effort mark failed
    try {
      const body = await req.clone().json();
      if (body?.store_id && body?.sale_id && body?.void_request_id) {
        const idemKey = `${body.sale_id}::${body.void_request_id}`;
        const existing = await base44.asServiceRole.entities.IdempotencyKey.filter({ store_id: body.store_id, key_type: "voidSale", key: idemKey });
        if (existing?.[0]?.id) await markIdempotentFailed(base44, existing[0].id, asErrorMessage(err));
      }
    } catch (_e) {}
    const msg = asErrorMessage(err);
    const code = (err && typeof err === "object" && "code" in err) ? String((err as any).code) : "INTERNAL";
    const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "PIN_REQUIRED" ? 403 : 500;
    return jsonFail(status, code, msg);
  }
});
