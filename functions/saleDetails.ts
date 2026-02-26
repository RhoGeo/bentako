import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { restGet } from "./_lib/supabaseAdmin.ts";

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function buildInFilter(field: string, values: string[]) {
  const vals = uniq(values);
  if (!vals.length) return "";
  return `&${field}=in.(${vals.join(",")})`;
}

function asMoneyInt(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function asQty(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function saleDetails(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();

    const store_id = String(body?.store_id || "").trim();
    const sale_id = String(body?.sale_id || "").trim();

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!sale_id) return jsonFail(400, "BAD_REQUEST", "sale_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "reports_drilldowns");

    // 1) Sale
    const salePath =
      `/rest/v1/sales` +
      `?select=sale_id,store_id,status,client_tx_id,device_id,receipt_number,customer_id,subtotal_centavos,discount_centavos,total_centavos,notes,created_at,completed_at,voided_at,refunded_at,created_by` +
      `&store_id=eq.${store_id}` +
      `&sale_id=eq.${sale_id}` +
      `&limit=1`;

    const sales: any[] = (await restGet<any[]>(salePath)) || [];
    const saleRow = sales?.[0];
    if (!saleRow) return jsonFail(404, "NOT_FOUND", "Sale not found");

    // 2) Sale items
    const itemsPath =
      `/rest/v1/sale_items` +
      `?select=sale_item_id,product_id,qty,unit_price_centavos,line_discount_centavos,cost_price_snapshot_centavos,created_at` +
      `&store_id=eq.${store_id}` +
      `&sale_id=eq.${sale_id}` +
      `&order=created_at.asc`;

    const itemRows: any[] = (await restGet<any[]>(itemsPath)) || [];
    const productIds = uniq(itemRows.map((r) => String(r.product_id || "")));

    // 3) Products lookup for item enrichment
    const productMap = new Map<string, any>();
    if (productIds.length) {
      const productsPath =
        `/rest/v1/products` +
        `?select=product_id,name,sku,barcode,price_centavos` +
        `&store_id=eq.${store_id}` +
        buildInFilter("product_id", productIds);
      const products: any[] = (await restGet<any[]>(productsPath)) || [];
      for (const p of products) productMap.set(String(p.product_id), p);
    }

    const items = itemRows.map((r) => {
      const pid = String(r.product_id || "");
      const p = productMap.get(pid) || {};
      const qty = asQty(r.qty);
      const unit = asMoneyInt(r.unit_price_centavos);
      const disc = asMoneyInt(r.line_discount_centavos);
      const line_total_centavos = Math.max(0, Math.round(qty * unit) - disc);
      return {
        ...r,
        product_name: p?.name ?? null,
        sku: p?.sku ?? null,
        barcode: p?.barcode ?? null,
        line_total_centavos,
      };
    });

    // 4) Payments
    const payPath =
      `/rest/v1/payment_ledger` +
      `?select=payment_id,sale_id,method,amount_centavos,is_refund,notes,created_by,created_at` +
      `&store_id=eq.${store_id}` +
      `&sale_id=eq.${sale_id}` +
      `&order=created_at.asc`;

    const paymentsRaw: any[] = (await restGet<any[]>(payPath)) || [];
    const payUserIds = uniq(paymentsRaw.map((p) => String(p.created_by || "")));

    const userMap = new Map<string, { email?: string; full_name?: string }>();
    const cashierId = String(saleRow.created_by || "");
    const allUserIds = uniq([...payUserIds, cashierId].filter(Boolean));
    if (allUserIds.length) {
      const usersPath =
        `/rest/v1/user_accounts` +
        `?select=user_id,email,full_name` +
        buildInFilter("user_id", allUserIds);
      const users: any[] = (await restGet<any[]>(usersPath)) || [];
      for (const u of users) userMap.set(String(u.user_id), { email: u.email, full_name: u.full_name });
    }

    const payments = paymentsRaw.map((p) => {
      const u = userMap.get(String(p.created_by || "")) || {};
      return {
        ...p,
        recorded_by_email: u.email || null,
        recorded_by_name: u.full_name || null,
      };
    });

    const paidRaw = paymentsRaw
      .filter((p) => !p.is_refund)
      .reduce((sum, p) => sum + asMoneyInt(p.amount_centavos), 0);

    const refundedRaw = paymentsRaw
      .filter((p) => !!p.is_refund)
      .reduce((sum, p) => sum + asMoneyInt(p.amount_centavos), 0);

    const total = asMoneyInt(saleRow.total_centavos);
    const refundable_centavos = Math.max(0, Math.min(total, paidRaw) - refundedRaw);

    // 5) Customer (optional)
    let customer: any = null;
    const customer_id = String(saleRow.customer_id || "").trim();
    if (customer_id) {
      const custPath =
        `/rest/v1/customers` +
        `?select=customer_id,name,phone,address,allow_utang,credit_limit_centavos,balance_due_centavos` +
        `&store_id=eq.${store_id}` +
        `&customer_id=eq.${customer_id}` +
        `&limit=1`;
      const custRows: any[] = (await restGet<any[]>(custPath)) || [];
      customer = custRows?.[0] || null;
    }

    // Cashier fields
    const cashier = userMap.get(cashierId) || {};
    const sale = {
      ...saleRow,
      cashier_email: cashier.email || null,
      cashier_name: cashier.full_name || null,
      customer,
      refundable_centavos,
      paid_centavos: paidRaw,
      refunded_centavos: refundedRaw,
    };

    return jsonOk({
      sale,
      items,
      payments,
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(saleDetails);
