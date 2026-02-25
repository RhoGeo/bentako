import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";
import { startIdempotentOperation, markIdempotentApplied } from "./_lib/idempotency.ts";
import { applyStockDeltaWithLedger } from "./_lib/stockAtomic.ts";
import { assertCentavosInt } from "./_lib/money.ts";
import { requireAuth } from "./_lib/auth.ts";
import { logActivityEvent } from "./_lib/activity.ts";

function mutationKey(store_id: string, product_id: string, restock_id: string) {
  return `${store_id}::${product_id}::restock::${restock_id}`;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    const {
      store_id,
      product_id,
      restock_id,
      restock_qty,
      new_cost_centavos,
      device_id,
      owner_pin_proof,
      note,
    } = body || {};

    if (!store_id || !product_id || !restock_id) {
      return jsonFail(400, "BAD_REQUEST", "store_id, product_id, restock_id required");
    }

    const qty = Number(restock_qty ?? 0);
    if (!Number.isFinite(qty) || qty < 0) {
      return jsonFail(400, "BAD_REQUEST", "restock_qty must be a number >= 0");
    }

    const costCentavos = new_cost_centavos === undefined || new_cost_centavos === null ? null : Number(new_cost_centavos);
    if (costCentavos !== null) {
      assertCentavosInt(costCentavos, "new_cost_centavos");
      if (costCentavos < 0) return jsonFail(400, "BAD_REQUEST", "new_cost_centavos must be >= 0");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "inventory_adjust_stock",
      pinSettingField: "pin_required_stock_adjust",
      owner_pin_proof,
    });

    // Idempotency by store_id + restock_id
    const { record, duplicateApplied, appliedResult } = await startIdempotentOperation(
      base44,
      store_id,
      "restockProduct",
      restock_id,
      { product_id }
    );
    if (duplicateApplied && appliedResult) return jsonOk(appliedResult);

    // If a ledger already exists, do not re-apply cost changes.
    const key = mutationKey(store_id, product_id, restock_id);
    const existingLedger = await base44.asServiceRole.entities.StockLedger.filter({ store_id, mutation_key: key });
    if (existingLedger?.length) {
      const led = existingLedger[0];
      const result = {
        product_id,
        new_qty: Number(led.resulting_qty ?? led.new_qty ?? 0),
        new_cost_centavos: led.new_cost_centavos ?? null,
        ledger_id: led.id,
      };
      await markIdempotentApplied(base44, record.id, result);
      return jsonOk(result);
    }

    // Fetch product (store-scoped) for cost snapshot
    const prows = await base44.asServiceRole.entities.Product.filter({ id: product_id, store_id });
    const p = prows?.[0];
    if (!p) return jsonFail(404, "NOT_FOUND", "Product not found");
    const prev_cost_centavos = Number(p.cost_price_centavos || 0);

    // Update cost first (if provided). This is safe because we still key stock mutation by mutation_key.
    if (costCentavos !== null) {
      await base44.asServiceRole.entities.Product.update(product_id, {
        cost_price_centavos: costCentavos,
      });
    }

    const stockRes = await applyStockDeltaWithLedger(base44, {
      store_id,
      product_id,
      delta_qty: qty,
      reason: "restock",
      reference_type: "restock",
      reference_id: restock_id,
      device_id: device_id || null,
      client_tx_id: null,
      created_at_device: Date.now(),
    });

    // Attach cost metadata to the ledger entry
    try {
      const ledgerRows = await base44.asServiceRole.entities.StockLedger.filter({ store_id, mutation_key: key });
      const led = ledgerRows?.[0];
      if (led?.id) {
        await base44.asServiceRole.entities.StockLedger.update(led.id, {
          prev_cost_centavos,
          new_cost_centavos: costCentavos !== null ? costCentavos : Number(p.cost_price_centavos || 0),
          restock_qty: qty,
          note: note || "",
        });
      }
    } catch (_e) {}

    const result = {
      product_id,
      new_qty: stockRes.new_qty,
      new_cost_centavos: costCentavos,
      mutation_key: key,
    };
    await markIdempotentApplied(base44, record.id, result);

    await logActivityEvent(base44, {
      store_id,
      event_type: "stock_restocked",
      description: "Stock restocked",
      entity_id: product_id,
      user_id: user.user_id,
      actor_email: user.email,
      device_id: device_id || null,
      metadata_json: { restock_id, restock_qty: qty, new_cost_centavos: costCentavos, note: note || "" },
    });

    return jsonOk(result);
  } catch (err) {
    return jsonFailFromError(err);
  }
});
