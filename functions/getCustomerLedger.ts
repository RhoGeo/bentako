import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";

/**
 * Step 10 helper: fetch due customer ledger (sales + payments).
 *
 * Input:
 * { store_id, customer_id }
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const store_id = body?.store_id;
    const customer_id = body?.customer_id;

    if (!store_id || !customer_id) {
      return jsonFail(400, "BAD_REQUEST", "store_id and customer_id required");
    }

    const staff = await requireActiveStaff(
      base44,
      store_id,
      user.email,
      user.role,
      user.full_name
    );
    requirePermission(staff, "customers_view");

    const sales = await base44.asServiceRole.entities.Sale.filter({
      store_id,
      customer_id,
      // show due + recently completed to provide context
      // (client can filter)
      is_active: true,
    });

    const payments = await base44.asServiceRole.entities.Payment.filter({
      store_id,
      customer_id,
    });

    // Shape and slim down payloads (mobile + low-end phones)
    const due_sales = (sales || [])
      .filter((s: any) => s?.status === "due")
      .map((s: any) => ({
        sale_id: s.id,
        status: s.status,
        sale_date: s.sale_date || s.created_date,
        receipt_number: s.receipt_number || null,
        total_centavos: Number(s.total_centavos || 0),
        amount_paid_centavos: Number(s.amount_paid_centavos || 0),
        balance_due_centavos: Number(s.balance_due_centavos || 0),
        cashier_name: s.cashier_name || s.cashier_email || "",
        client_tx_id: s.client_tx_id || null,
      }))
      .sort((a: any, b: any) =>
        String(b.sale_date || "").localeCompare(String(a.sale_date || ""))
      );

    // Customer payments (from recordPayment) have payment_request_id.
    const customer_payments = (payments || [])
      .filter((p: any) => !!p.payment_request_id)
      .map((p: any) => ({
        payment_id: p.id,
        payment_request_id: p.payment_request_id,
        created_at: p.created_date,
        method: p.method,
        amount_centavos: Number(p.amount_centavos || 0),
        note: p.note || "",
        recorded_by_name: p.recorded_by_name || p.recorded_by || "",
      }))
      .sort((a: any, b: any) =>
        String(b.created_at || "").localeCompare(String(a.created_at || ""))
      );

    return jsonOk({ customer_id, due_sales, customer_payments });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
