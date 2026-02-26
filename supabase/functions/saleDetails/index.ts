import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type SaleRow = {
  sale_id: string;
  store_id: string;
  client_tx_id: string | null;
  receipt_number: string | null;
  status: string;
  total_centavos: number;
  subtotal_centavos?: number;
  discount_centavos?: number;
  notes?: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  voided_at: string | null;
  refunded_at: string | null;
  customer_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();

    const body = await req.json().catch(() => ({}));
    const store_id = str(body?.store_id);
    const sale_id = str(body?.sale_id);

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!sale_id) return jsonFail(400, "BAD_REQUEST", "sale_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "reports_access" });

    // 1) Load sale
    const { data: sale, error: saleErr } = await supabase
      .from("sales")
      .select(
        "sale_id,store_id,client_tx_id,receipt_number,status,total_centavos,subtotal_centavos,discount_centavos,notes,created_by,created_at,completed_at,voided_at,refunded_at,customer_id,deleted_at",
      )
      .eq("store_id", store_id)
      .eq("sale_id", sale_id)
      .maybeSingle();

    if (saleErr) throw new Error(saleErr.message);
    if (!sale || sale.deleted_at) return jsonFail(404, "NOT_FOUND", "sale not found");

    const s = sale as SaleRow & { deleted_at?: string | null };

    // 2) Cashier info
    const { data: cashier, error: cashierErr } = await supabase
      .from("user_accounts")
      .select("user_id,full_name,email")
      .eq("user_id", s.created_by)
      .maybeSingle();
    if (cashierErr) throw new Error(cashierErr.message);

    // 3) Customer (optional)
    let customer: any = null;
    if (s.customer_id) {
      const { data: c, error: cErr } = await supabase
        .from("customers")
        .select("customer_id,name,phone,address")
        .eq("store_id", store_id)
        .eq("customer_id", s.customer_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (cErr) throw new Error(cErr.message);
      customer = c ?? null;
    }

    // 4) Items + product info
    const { data: items, error: itemsErr } = await supabase
      .from("sale_items")
      .select("sale_item_id,product_id,qty,unit_price_centavos,line_discount_centavos,products(name,sku,barcode)")
      .eq("store_id", store_id)
      .eq("sale_id", sale_id)
      .order("created_at", { ascending: true });

    if (itemsErr) throw new Error(itemsErr.message);

    const mappedItems = (items ?? []).map((it: any) => {
      const qty = num(it.qty);
      const unit = num(it.unit_price_centavos);
      const disc = num(it.line_discount_centavos);
      const lineTotal = Math.max(0, Math.round(qty * unit) - disc);

      return {
        sale_item_id: it.sale_item_id,
        product_id: it.product_id,
        qty: it.qty, // keep original (numeric comes back as string)
        unit_price_centavos: unit,
        line_discount_centavos: disc,
        product_name: it.products?.name ?? null,
        sku: it.products?.sku ?? null,
        barcode: it.products?.barcode ?? null,
        line_total_centavos: lineTotal,
      };
    });

    // 5) Payments
    const { data: pays, error: payErr } = await supabase
      .from("payment_ledger")
      .select("payment_id,method,amount_centavos,is_refund,notes,created_by,created_at,user_accounts(full_name,email)")
      .eq("store_id", store_id)
      .eq("sale_id", sale_id)
      .order("created_at", { ascending: true });

    if (payErr) throw new Error(payErr.message);

    const payments = (pays ?? []).map((p: any) => ({
      payment_id: p.payment_id,
      method: p.method,
      amount_centavos: num(p.amount_centavos),
      is_refund: !!p.is_refund,
      notes: p.notes ?? null,
      created_at: p.created_at,
      recorded_by_email: p.user_accounts?.email ?? null,
      recorded_by_name: p.user_accounts?.full_name ?? null,
    }));

    const paid_centavos = payments.filter((p: any) => !p.is_refund).reduce((a: number, p: any) => a + num(p.amount_centavos), 0);
    const refunded_centavos = payments.filter((p: any) => p.is_refund).reduce((a: number, p: any) => a + num(p.amount_centavos), 0);
    const refundable_centavos = Math.max(0, paid_centavos - refunded_centavos);

    return jsonOk(
      {
        sale: {
          sale_id: s.sale_id,
          store_id: s.store_id,
          client_tx_id: s.client_tx_id,
          receipt_number: s.receipt_number,
          status: s.status,
          total_centavos: num(s.total_centavos),
          subtotal_centavos: num((s as any).subtotal_centavos),
          discount_centavos: num((s as any).discount_centavos),
          notes: (s as any).notes ?? null,
          created_at: s.created_at,
          completed_at: s.completed_at,
          voided_at: s.voided_at,
          refunded_at: s.refunded_at,
          cashier_email: cashier?.email ?? null,
          cashier_name: cashier?.full_name ?? null,
          customer,
          paid_centavos,
          refunded_centavos,
          refundable_centavos,
        },
        items: mappedItems,
        payments,
      },
      200,
    );
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
