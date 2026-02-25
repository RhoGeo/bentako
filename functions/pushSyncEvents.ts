/**
 * pushSyncEvents (Step 3)
 * Batch ingestion of offline events with per-event results + statuses.
 *
 * Contract:
 * - Input: { store_id, device_id, events: [ { event_id, store_id, device_id, client_tx_id?, event_type, payload, created_at_device } ] }
 * - Output: { ok:true, data:{ results:[{event_id,status,data?,error?}], server_time } }
 */

import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFailFromError, jsonFail } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin, requirePermission } from "./_lib/guard.ts";
import { classifyFailure, toApiError } from "./_lib/errorPolicy.ts";
import { applyStockDeltaWithLedger, ADJUSTMENT_REASONS } from "./_lib/stockAtomic.ts";
import { nextReceiptNumber } from "./_lib/receiptSequence.ts";
import { assertCentavosInt } from "./_lib/money.ts";
import { normalizeSaleItems, sumQtyByProduct } from "./_lib/saleItems.ts";
import { startIdempotentOperation, markIdempotentApplied, markIdempotentFailed } from "./_lib/idempotency.ts";
import { assertPushBody, assertEventEnvelope, requireClientTxId } from "./_lib/syncContract.ts";
import { logActivityEvent } from "./_lib/activity.ts";

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
      client_tx_id: event.client_tx_id || event.payload?.client_tx_id || null,
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

async function applyCompleteSale(
  base44: any,
  store_id: string,
  device_id: string,
  payload: any,
  actor: { email: string; name?: string },
  staff: any,
) {
  const client_tx_id = payload?.client_tx_id;
  const sale = payload?.sale;
  if (!client_tx_id || !sale) throw Object.assign(new Error("client_tx_id and sale required"), { code: "BAD_REQUEST" });

  const status = sale?.status || "completed";
  const items = normalizeSaleItems(Array.isArray(sale?.items) ? sale.items : []);
  if (items.length === 0) throw Object.assign(new Error("sale.items required"), { code: "BAD_REQUEST" });

  // Validate payments
  const payments = Array.isArray(sale?.payments) ? sale.payments : [];
  for (const p of payments) {
    if (!p?.method) throw Object.assign(new Error("payment.method required"), { code: "BAD_REQUEST" });
    const amt = Number(p?.amount_centavos || 0);
    assertCentavosInt(amt, "payment.amount_centavos");
  }

  const discount_centavos = Number(sale?.discount_centavos || 0);
  assertCentavosInt(discount_centavos, "discount_centavos");

  // Discount override gate (Step 11)
  const owner_pin_proof = payload?.owner_pin_proof ?? null;
  const anyLineDiscount = items.some((it: any) => Number(it?.line_discount_centavos || 0) > 0);
  if (discount_centavos > 0 || anyLineDiscount) {
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "transaction_discount_override",
      pinSettingField: "pin_required_discount_override",
      owner_pin_proof,
    });
  }

  // totals
  let subtotal = 0;
  for (const it of items) {
    const qty = Number(it?.qty || 0);
    const unit = Number(it?.unit_price_centavos || 0);
    const lineDisc = Number(it?.line_discount_centavos || 0);
    if (qty <= 0) throw Object.assign(new Error("qty must be > 0"), { code: "BAD_REQUEST" });
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

  // Create or resume sale
  const existing = await base44.asServiceRole.entities.Sale.filter({ store_id, client_tx_id });
  const existingSale = existing?.[0] || null;

  const saleRow = existingSale
    ? existingSale
    : await base44.asServiceRole.entities.Sale.create({
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
        balance_due_applied: false,
      });

  if (existingSale) {
    try {
      await base44.asServiceRole.entities.Sale.update(saleRow.id, {
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
        updated_at: new Date().toISOString(),
      });
    } catch (_e) {}
  }

  // SaleItem rows idempotent (line_key)
  const existingItems = await base44.asServiceRole.entities.SaleItem.filter({ store_id, sale_id: saleRow.id });
  const existingLineKeys = new Set((existingItems || []).map((r: any) => String(r.line_key || "")));
  for (let idx = 0; idx < items.length; idx++) {
    const it: any = items[idx];
    const product_id = String(it.product_id);
    const qty = Number(it.qty || 0);
    const unit = Number(it.unit_price_centavos || 0);
    const lineDisc = Number(it.line_discount_centavos || 0);

    const products = await base44.asServiceRole.entities.Product.filter({ id: product_id, store_id });
    const product = products?.[0];
    if (!product) throw Object.assign(new Error(`Product not found: ${product_id}`), { code: "NOT_FOUND" });
    if (product.product_type === "parent") throw Object.assign(new Error("Parent products are not sellable"), { code: "BAD_REQUEST" });

    // Price override gate (Step 11)
    const basePrice = Number(product.selling_price_centavos ?? 0);
    if (Number.isFinite(basePrice) && basePrice >= 0 && unit !== basePrice) {
      await requirePermissionOrOwnerPin(base44, staff, {
        store_id,
        permission: "transaction_price_override",
        pinSettingField: "pin_required_price_override",
        owner_pin_proof,
      });
    }

    const costSnap = Number(product.cost_price_centavos || 0);
    assertCentavosInt(costSnap, "cost_price_snapshot_centavos");

    const line_key = `${saleRow.id}::${product_id}::${unit}::${lineDisc}::${idx}`;
    if (!existingLineKeys.has(line_key)) {
      await base44.asServiceRole.entities.SaleItem.create({
        store_id,
        sale_id: saleRow.id,
        product_id,
        qty,
        unit_price_centavos: unit,
        line_discount_centavos: lineDisc,
        cost_price_snapshot_centavos: costSnap,
        line_key,
      });
    }
  }

  // Stock decreases on completed/due — apply ONCE per product
  if (status === "completed" || status === "due") {
    const qtyByProduct = sumQtyByProduct(items);
    for (const [product_id, qty] of Object.entries(qtyByProduct)) {
      await applyStockDeltaWithLedger(base44, {
        store_id,
        product_id,
        delta_qty: -Number(qty),
        reason: "sale",
        reference_type: "sale",
        reference_id: saleRow.id,
        device_id,
        client_tx_id,
        created_at_device: Date.now(),
      });
    }
  }

  // Payment rows idempotent (payment_key)
  const existingPayments = await base44.asServiceRole.entities.Payment.filter({ store_id, sale_id: saleRow.id });
  const existingPayKeys = new Set((existingPayments || []).map((r: any) => String(r.payment_key || "")));
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const payment_key = `${saleRow.id}::${i}`;
    if (existingPayKeys.has(payment_key)) continue;
    await base44.asServiceRole.entities.Payment.create({
      store_id,
      sale_id: saleRow.id,
      method: p.method,
      amount_centavos: Number(p.amount_centavos),
      device_id,
      client_tx_id,
      payment_key,
    });
  }

  // Customer balance for due (idempotent via sale.balance_due_applied)
  if (status === "due" && sale?.customer_id && balance_due_centavos > 0) {
    const refreshedSale = await base44.asServiceRole.entities.Sale.filter({ id: saleRow.id, store_id });
    const s2 = refreshedSale?.[0];
    if (s2 && s2.balance_due_applied !== true) {
      const customers = await base44.asServiceRole.entities.Customer.filter({ id: sale.customer_id, store_id });
      const cust = customers?.[0];
      if (cust) {
        await base44.asServiceRole.entities.Customer.update(cust.id, {
          balance_due_centavos: Number(cust.balance_due_centavos || 0) + balance_due_centavos,
          last_transaction_date: new Date().toISOString(),
        });
      }
      await base44.asServiceRole.entities.Sale.update(saleRow.id, {
        balance_due_applied: true,
      });
    }
  }

  // Receipt numbering assigned when online — ensure exists
  let receipt = saleRow.receipt_number || null;
  if (!receipt) {
    receipt = await nextReceiptNumber(base44, store_id);
    await base44.asServiceRole.entities.Sale.update(saleRow.id, { receipt_number: receipt });
  }

  const wasDuplicate = !!existingSale;
  return {
    status: wasDuplicate ? "duplicate_ignored" : "applied",
    data: { server_sale_id: saleRow.id, server_receipt_number: receipt },
  };
}

async function applyParkSale(base44: any, store_id: string, device_id: string, payload: any, actor: { email: string; name?: string }) {
  const client_tx_id = payload?.client_tx_id;
  const sale = payload?.sale;
  if (!client_tx_id || !sale) throw Object.assign(new Error("client_tx_id and sale required"), { code: "BAD_REQUEST" });

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
  if (!sale_id || !void_request_id) throw Object.assign(new Error("sale_id and void_request_id required"), { code: "BAD_REQUEST" });

  const sales = await base44.asServiceRole.entities.Sale.filter({ id: sale_id, store_id });
  const sale = sales?.[0];
  if (!sale) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });

  if (sale.status === "voided") {
    // If already voided (possibly by a different request_id), do NOT restore stock again.
    throw Object.assign(new Error("Sale already voided"), { code: "ALREADY_VOIDED" });
  }

  const items = Array.isArray(sale.items) ? sale.items : [];
  if (sale.status === "completed" || sale.status === "due") {
    const qtyByProduct = sumQtyByProduct(items);
    for (const [product_id, qty] of Object.entries(qtyByProduct)) {
      await applyStockDeltaWithLedger(base44, {
        store_id,
        product_id,
        delta_qty: Number(qty),
        reason: "void",
        reference_type: "void",
        reference_id: sale_id,
        device_id: device_id || sale.device_id || null,
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
  if (!sale_id || !refund_request_id) throw Object.assign(new Error("sale_id and refund_request_id required"), { code: "BAD_REQUEST" });

  const sales = await base44.asServiceRole.entities.Sale.filter({ id: sale_id, store_id });
  const sale = sales?.[0];
  if (!sale) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });

  if (sale.status === "refunded") {
    throw Object.assign(new Error("Sale already refunded"), { code: "ALREADY_REFUNDED" });
  }

  const items = Array.isArray(sale.items) ? sale.items : [];
  if (sale.status === "completed" || sale.status === "due") {
    const qtyByProduct = sumQtyByProduct(items);
    for (const [product_id, qty] of Object.entries(qtyByProduct)) {
      await applyStockDeltaWithLedger(base44, {
        store_id,
        product_id,
        delta_qty: Number(qty),
        reason: "refund",
        reference_type: "refund",
        reference_id: sale_id,
        device_id: device_id || sale.device_id || null,
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
  const { product_id, delta_qty, reason, adjustment_id, device_id } = payload || {};
  if (!product_id || delta_qty === undefined || !reason || !adjustment_id) {
    throw Object.assign(new Error("product_id, delta_qty, reason, adjustment_id required"), { code: "BAD_REQUEST" });
  }
  if (!ADJUSTMENT_REASONS.includes(reason)) {
    throw Object.assign(new Error(`Invalid reason: ${reason}`), { code: "BAD_REQUEST" });
  }

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
  if (!customer_id || !payment_request_id || !payment?.method) {
    throw Object.assign(new Error("customer_id, payment_request_id, payment.method required"), { code: "BAD_REQUEST" });
  }
  const amount_centavos = Number(payment.amount_centavos || 0);
  assertCentavosInt(amount_centavos, "payment.amount_centavos");
  if (amount_centavos <= 0) throw Object.assign(new Error("amount_centavos must be > 0"), { code: "BAD_REQUEST" });

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
  if (!cust) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });

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
  if (!product_id || !restock_id) throw Object.assign(new Error("product_id and restock_id required"), { code: "BAD_REQUEST" });

  const qty = Number(restock_qty ?? 0);
  if (!Number.isFinite(qty) || qty < 0) throw Object.assign(new Error("restock_qty must be >= 0"), { code: "BAD_REQUEST" });

  const costCentavos = new_cost_centavos === undefined || new_cost_centavos === null ? null : Number(new_cost_centavos);
  if (costCentavos !== null) {
    assertCentavosInt(costCentavos, "new_cost_centavos");
    if (costCentavos < 0) throw Object.assign(new Error("new_cost_centavos must be >= 0"), { code: "BAD_REQUEST" });
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
  if (!p) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
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

  // Backfill ledger metadata best-effort
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

function idempotencyKeyForEvent(ev: any): { key_type: string; key: string; meta?: Record<string, unknown> } | null {
  const t = String(ev?.event_type || "");
  const payload = ev?.payload || {};

  if (t === "completeSale" || t === "parkSale") {
    const client_tx_id = requireClientTxId(ev);
    return { key_type: t, key: client_tx_id };
  }

  if (t === "voidSale") {
    if (!payload?.sale_id || !payload?.void_request_id) {
      throw Object.assign(new Error("sale_id and void_request_id required"), { code: "BAD_REQUEST" });
    }
    return { key_type: "voidSale", key: `${payload.sale_id}::${payload.void_request_id}`, meta: { sale_id: payload.sale_id } };
  }

  if (t === "refundSale") {
    if (!payload?.sale_id || !payload?.refund_request_id) {
      throw Object.assign(new Error("sale_id and refund_request_id required"), { code: "BAD_REQUEST" });
    }
    return { key_type: "refundSale", key: `${payload.sale_id}::${payload.refund_request_id}`, meta: { sale_id: payload.sale_id } };
  }

  if (t === "adjustStock") {
    if (!payload?.adjustment_id) {
      throw Object.assign(new Error("adjustment_id required"), { code: "BAD_REQUEST" });
    }
    return { key_type: "adjustStock", key: String(payload.adjustment_id), meta: { product_id: payload.product_id } };
  }

  if (t === "recordPayment") {
    if (!payload?.payment_request_id) {
      throw Object.assign(new Error("payment_request_id required"), { code: "BAD_REQUEST" });
    }
    return { key_type: "recordPayment", key: String(payload.payment_request_id), meta: { customer_id: payload.customer_id } };
  }

  if (t === "restockProduct") {
    if (!payload?.product_id || !payload?.restock_id) {
      throw Object.assign(new Error("product_id and restock_id required"), { code: "BAD_REQUEST" });
    }
    return { key_type: "restockProduct", key: `${payload.product_id}::${payload.restock_id}`, meta: { product_id: payload.product_id } };
  }

  return null;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    assertPushBody(body);

    const store_id = body.store_id;
    const device_id = body.device_id;
    const events = body.events;

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);

    const results: any[] = [];
    for (const ev of events) {
      try {
        assertEventEnvelope(ev, { store_id, device_id });

        // Fast path: if we have a SyncEvent entity and this event_id was already applied, return the stored result.
        const existingSync = await getExistingSyncEvent(base44, store_id, ev.event_id);
        if (existingSync && (existingSync.status === "applied" || existingSync.status === "duplicate_ignored")) {
          results.push({ event_id: ev.event_id, status: "duplicate_ignored", data: existingSync.result_json || null });
          continue;
        }
        if (existingSync && existingSync.status === "failed_permanent") {
          results.push({
            event_id: ev.event_id,
            status: "failed_permanent",
            error: (() => {
              if (!existingSync.last_error) return { code: "UNKNOWN", message: "Previously failed" };
              try { return JSON.parse(existingSync.last_error); } catch (_e) { return { code: "UNKNOWN", message: String(existingSync.last_error) }; }
            })(),
          });
          continue;
        }

        // Idempotency (business-key)
        const idem = idempotencyKeyForEvent(ev);
        let idemRecord: any = null;
        if (idem) {
          const started = await startIdempotentOperation(base44, store_id, idem.key_type, idem.key, idem.meta);
          idemRecord = started.record;

          // Meta collision guard: same idempotency key used for different entity.
          if (idem.meta && idemRecord?.meta && typeof idemRecord.meta === "object") {
            for (const [k, v] of Object.entries(idem.meta)) {
              if (v === undefined || v === null) continue;
              const existingV = (idemRecord.meta as any)[k];
              if (existingV !== undefined && existingV !== null && String(existingV) !== String(v)) {
                throw Object.assign(new Error("Idempotency key collision"), {
                  code: "IDEMPOTENCY_KEY_COLLISION",
                  details: { key_type: idem.key_type, key: idem.key, meta_expected: idem.meta, meta_existing: idemRecord.meta },
                });
              }
            }
          }

          if (started.duplicateApplied && started.appliedResult) {
            await saveSyncEvent(base44, store_id, ev, "duplicate_ignored", started.appliedResult, null);
            results.push({ event_id: ev.event_id, status: "duplicate_ignored", data: started.appliedResult });
            continue;
          }
        }

        // Apply
        const t = String(ev.event_type);
        let applied: any;
        if (t === "completeSale") {
          requirePermission(staff, "transaction_complete");
          applied = await applyCompleteSale(base44, store_id, device_id, ev.payload, { email: user.email, name: user.full_name }, staff);
        } else if (t === "parkSale") {
          requirePermission(staff, "transaction_complete");
          applied = await applyParkSale(base44, store_id, device_id, ev.payload, { email: user.email, name: user.full_name });
        } else if (t === "adjustStock") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "inventory_adjust_stock",
            pinSettingField: "pin_required_stock_adjust",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyAdjustStock(base44, store_id, ev.payload);
        } else if (t === "recordPayment") {
          requirePermission(staff, "customers_record_payment");
          applied = await applyRecordPayment(base44, store_id, ev.payload, { email: user.email, name: user.full_name });
        } else if (t === "restockProduct") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "inventory_adjust_stock",
            pinSettingField: "pin_required_stock_adjust",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyRestockProduct(base44, store_id, ev.payload);
        } else if (t === "voidSale") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "transaction_void",
            pinSettingField: "pin_required_void_refund",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyVoidSale(base44, store_id, ev.payload);
        } else if (t === "refundSale") {
          await requirePermissionOrOwnerPin(base44, staff, {
            store_id,
            permission: "transaction_refund",
            pinSettingField: "pin_required_void_refund",
            owner_pin_proof: ev.payload?.owner_pin_proof,
          });
          applied = await applyRefundSale(base44, store_id, ev.payload);
        } else {
          throw Object.assign(new Error(`Unknown event_type: ${t}`), { code: "BAD_REQUEST" });
        }

        const finalStatus = applied.status;
        const data = applied.data || null;

        // Mark idempotency key as applied (store operation result)
        if (idemRecord?.id) {
          await markIdempotentApplied(base44, idemRecord.id, data);
        }

        await saveSyncEvent(base44, store_id, ev, finalStatus, data, null);
        results.push({ event_id: ev.event_id, status: finalStatus, data });
      } catch (err) {
        const status = classifyFailure(err);
        const apiErr = toApiError(err);

        // best-effort idempotency mark failed
        try {
          const idem = idempotencyKeyForEvent(ev);
          if (idem) {
            const existing = await base44.asServiceRole.entities.IdempotencyKey.filter({ store_id, key_type: idem.key_type, key: idem.key });
            if (existing?.[0]?.id) await markIdempotentFailed(base44, existing[0].id, apiErr.message);
          }
        } catch (_e) {}

        await saveSyncEvent(base44, store_id, ev, status, null, apiErr);
        results.push({ event_id: ev?.event_id || "", status, error: apiErr });
      }
    }

    // Audit sync outcomes (Step 11)
    try {
      const counts = {
        applied: results.filter((r) => r.status === "applied").length,
        duplicate_ignored: results.filter((r) => r.status === "duplicate_ignored").length,
        failed_retry: results.filter((r) => r.status === "failed_retry").length,
        failed_permanent: results.filter((r) => r.status === "failed_permanent").length,
        total: results.length,
      };
      await logActivityEvent(base44, {
        store_id,
        event_type: counts.failed_permanent > 0 ? "sync_push_attention" : "sync_push_ok",
        description: "Sync push processed",
        user_id: user.user_id,
        actor_email: user.email,
        device_id,
        metadata_json: { counts },
      });

      for (const r of results.filter((x) => x.status === "failed_permanent")) {
        await logActivityEvent(base44, {
          store_id,
          event_type: "sync_event_failed_permanent",
          description: "Sync event failed permanently",
          user_id: user.user_id,
          actor_email: user.email,
          device_id,
          metadata_json: { event_id: r.event_id, error: r.error || null },
        });
      }
    } catch (_e) {}

    return jsonOk({ results, server_time: Date.now() });
  } catch (err) {
    // Map auth/permission errors to proper status codes so the client doesn't endlessly retry.
    return jsonFailFromError(err);
  }
});
