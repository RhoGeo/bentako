import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, asErrorMessage } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { startIdempotentOperation, markIdempotentApplied, markIdempotentFailed } from "./_lib/idempotency.ts";
import { nextReceiptNumber } from "./_lib/receiptSequence.ts";
import { applyStockDeltaWithLedger } from "./_lib/stockAtomic.ts";
import { assertCentavosInt } from "./_lib/money.ts";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const store_id = body?.store_id;
    const client_tx_id = body?.client_tx_id;
    const device_id = body?.device_id;
    const sale = body?.sale;

    if (!store_id || !client_tx_id || !device_id || !sale) {
      return jsonFail(400, "BAD_REQUEST", "store_id, client_tx_id, device_id, sale required");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "transaction_complete");

    // Idempotency: store_id + client_tx_id
    const { record, duplicateApplied, appliedResult } = await startIdempotentOperation(
      base44,
      store_id,
      "completeSale",
      client_tx_id,
      { device_id }
    );
    if (duplicateApplied && appliedResult) {
      return jsonOk(appliedResult);
    }

    // Secondary idempotency: existing sale
    const existing = await base44.asServiceRole.entities.Sale.filter({ store_id, client_tx_id });
    if (existing?.length) {
      const s = existing[0];
      const result = { sale_id: s.id, receipt_number: s.receipt_number || null };
      await markIdempotentApplied(base44, record.id, result);
      return jsonOk(result);
    }

    const status = sale?.status || "completed";
    const items = Array.isArray(sale?.items) ? sale.items : [];
    const discount_centavos = Number(sale?.discount_centavos || 0);
    assertCentavosInt(discount_centavos, "discount_centavos");

    if (items.length === 0) {
      return jsonFail(400, "BAD_REQUEST", "sale.items required");
    }

    // Validate payments
    const payments = Array.isArray(sale?.payments) ? sale.payments : [];
    for (const p of payments) {
      if (!p?.method) return jsonFail(400, "BAD_REQUEST", "payment.method required");
      const amt = Number(p?.amount_centavos || 0);
      assertCentavosInt(amt, "payment.amount_centavos");
    }

    // Build sale totals
    let subtotal = 0;
    for (const it of items) {
      const qty = Number(it?.qty || 0);
      const unit = Number(it?.unit_price_centavos || 0);
      const lineDisc = Number(it?.line_discount_centavos || 0);
      if (qty <= 0) return jsonFail(400, "BAD_REQUEST", "qty must be > 0");
      assertCentavosInt(unit, "unit_price_centavos");
      assertCentavosInt(lineDisc, "line_discount_centavos");
      subtotal += qty * unit - lineDisc;
    }
    assertCentavosInt(subtotal, "subtotal_centavos");
    const total_centavos = subtotal - discount_centavos;
    assertCentavosInt(total_centavos, "total_centavos");
    const amount_paid_centavos = payments.reduce((s, p) => s + Number(p.amount_centavos || 0), 0);
    assertCentavosInt(amount_paid_centavos, "amount_paid_centavos");
    const change_centavos = status === "completed" ? Math.max(0, amount_paid_centavos - total_centavos) : 0;
    const balance_due_centavos = status === "due" ? Math.max(0, total_centavos - Math.min(amount_paid_centavos, total_centavos)) : 0;
    assertCentavosInt(change_centavos, "change_centavos");
    assertCentavosInt(balance_due_centavos, "balance_due_centavos");

    // Create sale
    const saleRow = await base44.asServiceRole.entities.Sale.create({
      store_id,
      client_tx_id,
      device_id,
      cashier_email: user.email,
      cashier_name: user.full_name || "",
      sale_type: sale?.sale_type || "counter",
      status,
      items,
      discount_centavos,
      subtotal_centavos: subtotal,
      total_centavos,
      amount_paid_centavos,
      change_centavos,
      balance_due_centavos,
      payments,
      customer_id: sale?.customer_id || null,
      notes: sale?.notes || "",
      sale_date: new Date().toISOString(),
      is_synced: true,
    });

    // Create SaleItems + stock updates
    for (const it of items) {
      const product_id = it.product_id;
      const qty = Number(it.qty || 0);
      const unit = Number(it.unit_price_centavos || 0);
      const lineDisc = Number(it.line_discount_centavos || 0);

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
        unit_price_centavos: unit,
        line_discount_centavos: lineDisc,
        cost_price_snapshot_centavos: costSnap,
      });

      // Stock decreases on completed OR due
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

    // Payment rows
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

    // Customer balance for due
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

    // Receipt number
    const receipt_number = await nextReceiptNumber(base44, store_id);
    await base44.asServiceRole.entities.Sale.update(saleRow.id, { receipt_number });

    const result = { sale_id: saleRow.id, receipt_number };
    await markIdempotentApplied(base44, record.id, result);
    return jsonOk(result);
  } catch (err) {
    // Best-effort mark idempotency failed if we have a record
    try {
      const body = await req.clone().json();
      if (body?.store_id && body?.client_tx_id) {
        const existing = await base44.asServiceRole.entities.IdempotencyKey.filter({
          store_id: body.store_id,
          key_type: "completeSale",
          key: body.client_tx_id,
        });
        if (existing?.[0]?.id) await markIdempotentFailed(base44, existing[0].id, asErrorMessage(err));
      }
    } catch (_e) {}

    const msg = asErrorMessage(err);
    const code = (err && typeof err === "object" && "code" in err) ? String((err as any).code) : "INTERNAL";
    const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "BAD_REQUEST" ? 400 : 500;
    return jsonFail(status, code, msg);
  }
});
