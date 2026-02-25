/**
 * pushSyncEvents (Step 3)
 * Batch ingestion of offline events with per-event results + statuses.
 */

import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFailFromError, jsonFail, asErrorMessage } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin, requirePermission } from "./_lib/guard.ts";
import { classifyFailure, toApiError } from "./_lib/errorPolicy.ts";
import { applyStockDeltaWithLedger, ADJUSTMENT_REASONS } from "./_lib/stockAtomic.ts";
import { nextReceiptNumber } from "./_lib/receiptSequence.ts";
import { assertCentavosInt } from "./_lib/money.ts";

async function getExistingSyncEvent(base44: any, store_id: string, event_id: string) {
  // SyncEvent storage is optional (some projects may not have it).
  try {
    const ent = base44?.asServiceRole?.entities?.SyncEvent;
    if (!ent?.filter) return null;
    const rows = await ent.filter({ store_id, event_id });
    return rows?.[0] || null;
  } catch (_e) {
    return null;
  }
}

async function saveSyncEvent(base44: any, store_id: string, event: any, status: string, result_json: any, last_error?: any) {
  // Best-effort only; sync MUST work even if SyncEvent entity is unavailable.
  try {
    const ent = base44?.asServiceRole?.entities?.SyncEvent;
    if (!ent?.filter || !ent?.create) return null;
    const existing = await getExistingSyncEvent(base44, store_id, event.event_id);
    const payload_json = JSON.stringify(event.payload || {});
    const patch = {
      store_id,
      event_id: event.event_id,
      device_id: event.device_id,
      client_tx_id: event.client_tx_id || null,
      event_type: event.event_type,
      payload_json,
      status,
      attempt_count: Number(existing?.attempt_count || 0) + 1,
      last_error: last_error ? JSON.stringify(last_error) : null,
      result_json,
      created_at_device: event.created_at_device,
      updated_at: new Date().toISOString(),
    };
    if (existing?.id && ent?.update) {
      await ent.update(existing.id, patch);
      return existing.id;
    }
    const created = await ent.create({ ...patch, created_at: new Date().toISOString() });
    return created?.id || null;
  } catch (_e) {
    return null;
  }
}

async function applyCompleteSale(base44: any, store_id: string, device_id: string, payload: any, actor: { email: string; name?: string }) {
  const client_tx_id = payload?.client_tx_id;
  const sale = payload?.sale;
  if (!client_tx_id || !sale) throw new Error("client_tx_id and sale required");

  // business idempotency
  const existing = await base44.asServiceRole.entities.Sale.filter({ store_id, client_tx_id });
  if (existing?.length) {
    return {
      status: "duplicate_ignored",
      data: { server_sale_id: existing[0].id, server_receipt_number: existing[0].receipt_number || null },
    };
  }

  const status = sale?.status || "completed";
  const items = Array.isArray(sale?.items) ? sale.items : [];
  if (items.length === 0) throw new Error("sale.items required");

  const payments = Array.isArray(sale?.payments) ? sale.payments : [];
  for (const p of payments) {
    if (!p?.method) throw new Error("payment.method required");
    const amt = Number(p?.amount_centavos || 0);
    assertCentavosInt(amt, "payment.amount_centavos");
  }

  const discount_centavos = Number(sale?.discount_centavos || 0);
  assertCentavosInt(discount_centavos, "discount_centavos");

  // totals
  let subtotal = 0;
  for (const it of items) {
    const qty = Number(it?.qty || 0);
    const unit = Number(it?.unit_price_centavos || 0);
    const lineDisc = Number(it?.line_discount_centavos || 0);
    if (qty <= 0) throw new Error("qty must be > 0");
    assertCentavosInt(unit, "unit_price_centavos");
    assertCentavosInt(lineDisc, "line_discount_centavos");
    subtotal += qty * unit - lineDisc;
  }
  assertCentavosInt(subtotal, "subtotal_centavos");
  const total_centavos = subtotal - discount_centavos;
  assertCentavosInt(total_centavos, "total_centavos");

  const amount_paid_centavos = payments.reduce((s: number, p: any) => s + Number(p.amount_centavos || 0), 0);
  assertCentavosInt(amount_paid_centavos, "amount_paid_centavos");
  const change_centavos = status === "completed" ? Math.max(0, amount_paid_centavos - total_centavos) : 0;
  const balance_due_centavos = status === "due" ? Math.max(0, total_centavos - Math.min(amount_paid_centavos, total_centavos)) : 0;

  const saleRow = await base44.asServiceRole.entities.Sale.create({
    store_id,
    client_tx_id,
    device_id,
    cashier_email: actor.email,
    cashier_name: actor.name || "",
    sale_type: sale?.sale_type || "counter",
    status,
    items,
    payments,
    discount_centavos,
    subtotal_centavos: subtotal,
    total_centavos,
    amount_paid_centavos,
    change_centavos,
    balance_due_centavos,
    customer_id: sale?.customer_id || null,
    notes: sale?.notes || "",
    sale_date: new Date().toISOString(),
    is_synced: true,
  });

  for (const it of items) {
    const product_id = it.product_id;
    const qty = Number(it.qty || 0);
    const products = await base44.asServiceRole.entities.Product.filter({ id: product_id, store_id });
    const product = products?.[0];
    if (!product) throw new Error(`Product not found: ${product_id}`);
    if (product.product_type === "parent") throw new Error("Parent products are not sellable");
    const costSnap = Number(product.cost_price_centavos || 0);
    assertCentavosInt(costSnap, "cost_price_snapshot_centavos");
    await base44.asServiceRole.entities.SaleItem.create({
      store_id,
      sale_id: saleRow.id,
      product_id,
      qty,
      unit_price_centavos: Number(it.unit_price_centavos),
      line_discount_centavos: Number(it.line_discount_centavos || 0),
      cost_price_snapshot_centavos: costSnap,
    });

    if (status === "completed" || status === "due") {
      await applyStockDeltaWithLedger(base44, {
        store_id,
        product_id,
        delta_qty: -qty,
        reason: "sale",
        reference_type: "sale",
        reference_id: saleRow.id,
        device_id,
        client_tx_id,
        created_at_device: Date.now(),
      });
    }
  }

  for (const p of payments) {
    await base44.asServiceRole.entities.Payment.create({
      store_id,
      sale_id: saleRow.id,
      method: p.method,
      amount_centavos: Number(p.amount_centavos),
      device_id,
      client_tx_id,
    });
  }

  if (status === "due" && sale?.customer_id && balance_due_centavos > 0) {
    const customers = await base44.asServiceRole.entities.Customer.filter({ id: sale.customer_id, store_id });
    const cust = customers?.[0];
    if (cust) {
      await base44.asServiceRole.entities.Customer.update(cust.id, {
        balance_due_centavos: Number(cust.balance_due_centavos || 0) + balance_due_centavos,
        last_transaction_date: new Date().toISOString(),
      });
    }
  }

  const receipt = await nextReceiptNumber(base44, store_id);
  await base44.asServiceRole.entities.Sale.update(saleRow.id, { receipt_number: receipt });

  return { status: "applied", data: { server_sale_id: saleRow.id, server_receipt_number: receipt } };
}

async function applyParkSale(base44: any, store_id: string, device_id: string, payload: any, actor: { email: string; name?: string }) {
  const client_tx_id = payload?.client_tx_id;
  const sale = payload?.sale;
  if (!client_tx_id || !sale) throw new Error("client_tx_id and sale required");
  const existing = await base44.asServiceRole.entities.Sale.filter({ store_id, client_tx_id });
  if (existing?.length) {
    return { status: "duplicate_ignored", data: { server_sale_id: existing[0].id, server_receipt_number: null } };
  }
  const saleRow = await base44.asServiceRole.entities.Sale.create({
    store_id,
    client_tx_id,
    device_id,
    cashier_email: actor.email,
    cashier_name: actor.name || "",
    sale_type: sale?.sale_type || "counter",
    status: "parked",
    items: sale?.items || [],
    notes: sale?.notes || "",
    sale_date: new Date().toISOString(),
    is_synced: true,
  });
  return { status: "applied", data: { server_sale_id: saleRow.id, server_receipt_number: null } };
}

async function applyVoidSale(base44: any, store_id: string, payload: any) {
  const { sale_id, void_request_id, reason, device_id, client_tx_id } = payload || {};
  if (!sale_id || !void_request_id) throw new Error("sale_id and void_request_id required");

  // idempotency: check existing IdempotencyKey or sale.status
  const sales = await base44.asServiceRole.entities.Sale.filter({ id: sale_id, store_id });
  const sale = sales?.[0];
  if (!sale) throw new Error("Sale not found");
  if (sale.status === "voided") {
    return { status: "duplicate_ignored", data: { sale_id, status: "voided" } };
  }
  const items = Array.isArray(sale.items) ? sale.items : [];
  if (sale.status === "completed" || sale.status === "due") {
    for (const it of items) {
      await applyStockDeltaWithLedger(base44, {
        store_id,
        product_id: it.product_id,
        delta_qty: Number(it.qty || 0),
        reason: "void",
        reference_type: "void",
        reference_id: `${sale_id}::${void_request_id}`,
        device_id: device_id || null,
        client_tx_id: client_tx_id || sale.client_tx_id || null,
        created_at_device: Date.now(),
      });
    }
  }
  await base44.asServiceRole.entities.Sale.update(sale_id, {
    status: "voided",
    void_reason: reason || "",
    voided_at: new Date().toISOString(),
  });
  return { status: "applied", data: { sale_id, status: "voided" } };
}

async function applyRefundSale(base44: any, store_id: string, payload: any) {
  const { sale_id, refund_request_id, reason, device_id, client_tx_id } = payload || {};
  if (!sale_id || !refund_request_id) throw new Error("sale_id and refund_request_id required");
  const sales = await base44.asServiceRole.entities.Sale.filter({ id: sale_id, store_id });
  const sale = sales?.[0];
  if (!sale) throw new Error("Sale not found");
  if (sale.status === "refunded") {
    return { status: "duplicate_ignored", data: { sale_id, status: "refunded" } };
  }
  const items = Array.isArray(sale.items) ? sale.items : [];
  if (sale.status === "completed" || sale.status === "due") {
    for (const it of items) {
      await applyStockDeltaWithLedger(base44, {
        store_id,
        product_id: it.product_id,
        delta_qty: Number(it.qty || 0),
        reason: "refund",
        reference_type: "refund",
        reference_id: `${sale_id}::${refund_request_id}`,
        device_id: device_id || null,
        client_tx_id: client_tx_id || sale.client_tx_id || null,
        created_at_device: Date.now(),
      });
    }
  }
  await base44.asServiceRole.entities.Sale.update(sale_id, {
    status: "refunded",
    refund_reason: reason || "",
    refunded_at: new Date().toISOString(),
  });
  return { status: "applied", data: { sale_id, status: "refunded" } };
}

async function applyAdjustStock(base44: any, store_id: string, payload: any) {
  const { product_id, delta_qty, reason, adjustment_id, device_id, owner_pin_proof } = payload || {};
  if (!product_id || delta_qty === undefined || !reason || !adjustment_id) throw new Error("product_id, delta_qty, reason, adjustment_id required");
  if (!ADJUSTMENT_REASONS.includes(reason)) throw new Error(`Invalid reason: ${reason}`);

  // Business idempotency handled by stock mutation key reference_id = adjustment_id
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
  return { status: "applied", data: { product_id, new_qty: res.new_qty } };
}

async function applyRecordPayment(base44: any, store_id: string, payload: any, actor: { email: string; name?: string }) {
  const { customer_id, payment_request_id, device_id, payment } = payload || {};
  if (!customer_id || !payment_request_id || !payment?.method) throw new Error("customer_id, payment_request_id, payment.method required");
  const amount_centavos = Number(payment.amount_centavos || 0);
  assertCentavosInt(amount_centavos, "payment.amount_centavos");
  if (amount_centavos <= 0) throw new Error("amount_centavos must be > 0");

  // Idempotency: Payment with payment_request_id
  const existing = await base44.asServiceRole.entities.Payment.filter({ store_id, payment_request_id });
  if (existing?.length) {
    const cust = await base44.asServiceRole.entities.Customer.filter({ id: customer_id, store_id });
    return {
      status: "duplicate_ignored",
      data: { payment_id: existing[0].id, customer_id, new_balance_centavos: Number(cust?.[0]?.balance_due_centavos || 0) },
    };
  }

  const customers = await base44.asServiceRole.entities.Customer.filter({ id: customer_id, store_id });
  const cust = customers?.[0];
  if (!cust) throw new Error("Customer not found");
  const new_balance_centavos = Math.max(0, Number(cust.balance_due_centavos || 0) - amount_centavos);
  await base44.asServiceRole.entities.Customer.update(customer_id, {
    balance_due_centavos: new_balance_centavos,
    last_transaction_date: new Date().toISOString(),
  });
  const row = await base44.asServiceRole.entities.Payment.create({
    store_id,
    customer_id,
    payment_request_id,
    method: payment.method,
    amount_centavos,
    note: payment.note || "",
    device_id: device_id || null,
    recorded_by: actor.email,
    recorded_by_name: actor.name || "",
  });
  return { status: "applied", data: { payment_id: row.id, customer_id, new_balance_centavos } };
}

function restockMutationKey(store_id: string, product_id: string, restock_id: string) {
  return `${store_id}::${product_id}::restock::${restock_id}`;
}

async function applyRestockProduct(base44: any, store_id: string, payload: any) {
  const { product_id, restock_id, restock_qty, new_cost_centavos, device_id, note } = payload || {};
  if (!product_id || !restock_id) throw new Error("product_id and restock_id required");
  const qty = Number(restock_qty ?? 0);
  if (!Number.isFinite(qty) || qty < 0) throw new Error("restock_qty must be >= 0");

  const costCentavos = new_cost_centavos === undefined || new_cost_centavos === null ? null : Number(new_cost_centavos);
  if (costCentavos !== null) {
    assertCentavosInt(costCentavos, "new_cost_centavos");
    if (costCentavos < 0) throw new Error("new_cost_centavos must be >= 0");
  }

  const key = restockMutationKey(store_id, product_id, restock_id);
  const existingLedger = await base44.asServiceRole.entities.StockLedger.filter({ store_id, mutation_key: key });
  if (existingLedger?.length) {
    const led = existingLedger[0];
    return {
      status: "duplicate_ignored",
      data: {
        product_id,
        new_qty: Number(led.resulting_qty ?? led.new_qty ?? 0),
        ledger_id: led.id,
      },
    };
  }

  const prows = await base44.asServiceRole.entities.Product.filter({ id: product_id, store_id });
  const p = prows?.[0];
  if (!p) throw new Error("Product not found");
  const prev_cost_centavos = Number(p.cost_price_centavos || 0);

  if (costCentavos !== null) {
    await base44.asServiceRole.entities.Product.update(product_id, { cost_price_centavos: costCentavos });
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

  return { status: "applied", data: { product_id, new_qty: stockRes.new_qty } };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const store_id = body?.store_id;
    const device_id = body?.device_id;
    const events = Array.isArray(body?.events) ? body.events : [];
    if (!store_id || !device_id || events.length === 0) {
      return jsonFail(400, "BAD_REQUEST", "store_id, device_id, events[] required");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);

    const results = [];
    for (const ev of events) {
      const event_id = ev?.event_id;
      const event_type = ev?.event_type;
      if (!event_id || !event_type) {
        results.push({ event_id: event_id || "", status: "failed_permanent", error: { code: "BAD_REQUEST", message: "event_id and event_type required" } });
        continue;
      }
      if (ev.store_id !== store_id || ev.device_id !== device_id) {
        results.push({ event_id, status: "failed_permanent", error: { code: "BAD_REQUEST", message: "store_id/device_id mismatch" } });
        continue;
      }

      const existing = await getExistingSyncEvent(base44, store_id, event_id);
      if (existing && (existing.status === "applied" || existing.status === "duplicate_ignored")) {
        results.push({ event_id, status: "duplicate_ignored", data: existing.result_json || null });
        continue;
      }

      try {
        let applied;
        if (event_type === "completeSale") {
          requirePermission(staff, "transaction_complete");
          applied = await applyCompleteSale(base44, store_id, device_id, ev.payload, { email: user.email, name: user.full_name });
        } else if (event_type === "parkSale") {
          requirePermission(staff, "transaction_complete");
          applied = await applyParkSale(base44, store_id, device_id, ev.payload, { email: user.email, name: user.full_name });
        } else if (event_type === "adjustStock") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "inventory_adjust_stock",
            pinSettingField: "pin_required_stock_adjust",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyAdjustStock(base44, store_id, ev.payload);
        } else if (event_type === "recordPayment") {
          requirePermission(staff, "customers_record_payment");
          applied = await applyRecordPayment(base44, store_id, ev.payload, { email: user.email, name: user.full_name });
        } else if (event_type === "restockProduct") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "inventory_adjust_stock",
            pinSettingField: "pin_required_stock_adjust",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyRestockProduct(base44, store_id, ev.payload);
        } else if (event_type === "voidSale") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "transaction_void",
            pinSettingField: "pin_required_void_refund",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyVoidSale(base44, store_id, ev.payload);
        } else if (event_type === "refundSale") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "transaction_refund",
            pinSettingField: "pin_required_void_refund",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyRefundSale(base44, store_id, ev.payload);
        } else {
          throw new Error(`Unknown event_type: ${event_type}`);
        }

        const finalStatus = applied.status;
        const data = applied.data || null;
        await saveSyncEvent(base44, store_id, ev, finalStatus, data, null);
        results.push({ event_id, status: finalStatus, data });
      } catch (err) {
        const status = classifyFailure(err);
        const apiErr = toApiError(err);
        await saveSyncEvent(base44, store_id, ev, status, null, apiErr);
        results.push({ event_id, status, error: apiErr });
      }
    }

    return jsonOk({ results, server_time: Date.now() });
  } catch (err) {
    // Map auth/permission errors to proper status codes so the client doesn't endlessly retry.
    return jsonFailFromError(err);
  }
});
