import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, asErrorMessage } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission, requirePermissionOrOwnerPin } from "./_lib/guard.ts";
import { startIdempotentOperation, markIdempotentApplied, markIdempotentFailed } from "./_lib/idempotency.ts";
import { nextReceiptNumber } from "./_lib/receiptSequence.ts";
import { applyStockDeltaWithLedger } from "./_lib/stockAtomic.ts";
import { assertCentavosInt } from "./_lib/money.ts";
import { normalizeSaleItems, sumQtyByProduct } from "./_lib/saleItems.ts";
import { logActivityEvent } from "./_lib/activity.ts";
import { getStoreSettings } from "./_lib/storeSettings.ts";

export async function completeSale(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    const store_id = body?.store_id;
    const client_tx_id = body?.client_tx_id;
    const device_id = body?.device_id;
    const sale = body?.sale;
    const owner_pin_proof = body?.owner_pin_proof ?? null;

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

    // Crash-safe resume: if sale already exists for this client_tx_id, resume missing steps.
    const existing = await base44.asServiceRole.entities.Sale.filter({ store_id, client_tx_id });
    const existingSale = existing?.[0] || null;

    const status = sale?.status || "completed";
    const itemsRaw = Array.isArray(sale?.items) ? sale.items : [];
    const items = normalizeSaleItems(itemsRaw);
    const manual_discount_centavos = Number(sale?.discount_centavos || 0);
    assertCentavosInt(manual_discount_centavos, "discount_centavos");

    if (items.length === 0) return jsonFail(400, "BAD_REQUEST", "sale.items required");

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

    // Referral discount (Step 12.2): apply once → 10% discount forever (store setting)
    // This discount should NOT require discount override PIN.
    const settings = await getStoreSettings(base44, store_id);
    const referralPct = Number(settings?.referral_discount_percent || 0);
    const referral_discount_centavos = referralPct > 0
      ? Math.max(0, Math.floor(((subtotal - manual_discount_centavos) * referralPct) / 100))
      : 0;
    assertCentavosInt(referral_discount_centavos, "referral_discount_centavos");

    const discount_centavos = manual_discount_centavos + referral_discount_centavos;
    assertCentavosInt(discount_centavos, "discount_centavos");

    const total_centavos = subtotal - discount_centavos;
    assertCentavosInt(total_centavos, "total_centavos");
    const amount_paid_centavos = payments.reduce((s, p) => s + Number(p.amount_centavos || 0), 0);
    assertCentavosInt(amount_paid_centavos, "amount_paid_centavos");
    const change_centavos = status === "completed" ? Math.max(0, amount_paid_centavos - total_centavos) : 0;
    const balance_due_centavos = status === "due" ? Math.max(0, total_centavos - Math.min(amount_paid_centavos, total_centavos)) : 0;
    assertCentavosInt(change_centavos, "change_centavos");
    assertCentavosInt(balance_due_centavos, "balance_due_centavos");

    // Discount override gate (Step 11) — manual discounts only
    const anyLineDiscount = items.some((it) => Number(it?.line_discount_centavos || 0) > 0);
    if (manual_discount_centavos > 0 || anyLineDiscount) {
      await requirePermissionOrOwnerPin(base44, staff, {
        store_id,
        permission: "transaction_discount_override",
        pinSettingField: "pin_required_discount_override",
        owner_pin_proof,
      });
    }

    // Create (or resume) sale
    const saleRow = existingSale
      ? existingSale
      : await base44.asServiceRole.entities.Sale.create({
          store_id,
          client_tx_id,
          device_id,
          cashier_email: user.email,
          cashier_name: user.full_name || "",
          sale_type: sale?.sale_type || "counter",
          status,
          items,
          discount_centavos,
          manual_discount_centavos,
          referral_discount_centavos,
          referral_discount_percent: referralPct > 0 ? referralPct : null,
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
          balance_due_applied: false,
        });

    // Ensure latest payload is captured on resume (no stock impact)
    if (existingSale) {
      try {
        await base44.asServiceRole.entities.Sale.update(saleRow.id, {
          status,
          items,
          discount_centavos,
          manual_discount_centavos,
          referral_discount_centavos,
          referral_discount_percent: referralPct > 0 ? referralPct : null,
          subtotal_centavos: subtotal,
          total_centavos,
          amount_paid_centavos,
          change_centavos,
          balance_due_centavos,
          payments,
          customer_id: sale?.customer_id || null,
          notes: sale?.notes || "",
          updated_at: new Date().toISOString(),
        });
      } catch (_e) {}
    }

    // Create SaleItems idempotently (line_key) + collect qty-by-product for stock.
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
      if (!product) throw new Error(`Product not found: ${product_id}`);
      if (product.product_type === "parent") throw new Error("Parent products are not sellable");

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

    // Stock decreases on completed OR due — apply ONCE per product (prevents duplicate-line undercount)
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

    // Payment rows (idempotent by payment_key)
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
      const s2 = refreshedSale?.[0] || saleRow;
      if (!s2.balance_due_applied) {
        const customers = await base44.asServiceRole.entities.Customer.filter({ id: sale.customer_id, store_id });
        const cust = customers?.[0];
        if (cust) {
          await base44.asServiceRole.entities.Customer.update(cust.id, {
            balance_due_centavos: Number(cust.balance_due_centavos || 0) + balance_due_centavos,
            last_transaction_date: new Date().toISOString(),
          });
        }
        await base44.asServiceRole.entities.Sale.update(saleRow.id, { balance_due_applied: true });
      }
    }

    // Receipt number (assign once)
    let receipt_number = saleRow.receipt_number || null;
    if (!receipt_number) {
      receipt_number = await nextReceiptNumber(base44, store_id);
      await base44.asServiceRole.entities.Sale.update(saleRow.id, { receipt_number });
    }

    const result = { sale_id: saleRow.id, receipt_number };
    await markIdempotentApplied(base44, record.id, result);

    // Audit log (Step 11)
    await logActivityEvent(base44, {
      store_id,
      event_type: status === "due" ? "sale_due" : "sale_completed",
      description: status === "due" ? "Sale completed as due (utang)" : "Sale completed",
      entity_id: saleRow.id,
      user_id: user.user_id,
      actor_email: user.email,
      device_id,
      amount_centavos: total_centavos,
      metadata_json: { client_tx_id, status, items_count: items.length },
    });

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
}

Deno.serve(completeSale);
