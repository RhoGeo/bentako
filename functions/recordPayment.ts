import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { startIdempotentOperation, markIdempotentApplied } from "./_lib/idempotency.ts";
import { assertCentavosInt } from "./_lib/money.ts";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const store_id = body?.store_id;
    const customer_id = body?.customer_id;
    const payment_request_id = body?.payment_request_id;
    const device_id = body?.device_id || null;
    const payment = body?.payment;
    if (!store_id || !customer_id || !payment_request_id || !payment?.method) {
      return jsonFail(400, "BAD_REQUEST", "store_id, customer_id, payment_request_id, payment.method required");
    }
    const amount_centavos = Number(payment.amount_centavos || 0);
    assertCentavosInt(amount_centavos, "payment.amount_centavos");
    if (amount_centavos <= 0) return jsonFail(400, "BAD_REQUEST", "amount_centavos must be > 0");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "customers_record_payment");

    const { record, duplicateApplied, appliedResult } = await startIdempotentOperation(
      base44,
      store_id,
      "recordPayment",
      payment_request_id,
      { customer_id }
    );
    if (duplicateApplied && appliedResult) return jsonOk(appliedResult);

    const customers = await base44.asServiceRole.entities.Customer.filter({ id: customer_id, store_id });
    const cust = customers?.[0];
    if (!cust) return jsonFail(404, "NOT_FOUND", "Customer not found");

    const new_balance_centavos = Math.max(0, Number(cust.balance_due_centavos || 0) - amount_centavos);
    await base44.asServiceRole.entities.Customer.update(customer_id, {
      balance_due_centavos: new_balance_centavos,
      last_transaction_date: new Date().toISOString(),
    });

    const paymentRow = await base44.asServiceRole.entities.Payment.create({
      store_id,
      customer_id,
      payment_request_id,
      method: payment.method,
      amount_centavos,
      note: payment.note || "",
      device_id,
      recorded_by: user.email,
      recorded_by_name: user.full_name || "",
    });

    const result = { payment_id: paymentRow.id, customer_id, new_balance_centavos };
    await markIdempotentApplied(base44, record.id, result);
    return jsonOk(result);
  } catch (err) {
    return jsonFailFromError(err);
  }
});
