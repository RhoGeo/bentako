import { corsHeaders } from "../_shared/cors.ts";
import { jsonOk } from "../_shared/response.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";

/**
 * Step 10 helper: fetch due customer ledger (due sales + customer payments).
 *
 * Input: { store_id, customer_id }
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);

    const body = await req.json();
    const store_id = String(body?.store_id || "").trim();
    const customer_id = String(body?.customer_id || "").trim();
    if (!store_id || !customer_id) throw new Error("store_id and customer_id required");

    await requireStoreAccess({ user_id: user.user_id, store_id });

    // Due sales
    const { data: sales, error: sErr } = await supabase
      .from("sales")
      .select("sale_id,status,created_at,completed_at,receipt_number,total_centavos,client_tx_id,created_by")
      .eq("store_id", store_id)
      .eq("customer_id", customer_id)
      .eq("status", "due")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (sErr) throw new Error(sErr.message);

    const saleIds = (sales || []).map((s: any) => s.sale_id);

    // Payments for those sales (initial payments)
    let paymentsBySale = new Map<string, number>();
    if (saleIds.length) {
      const { data: pays, error: pErr } = await supabase
        .from("payment_ledger")
        .select("sale_id,amount_centavos,is_refund")
        .eq("store_id", store_id)
        .in("sale_id", saleIds)
        .eq("is_refund", false);
      if (pErr) throw new Error(pErr.message);
      for (const p of pays || []) {
        const sid = String((p as any).sale_id || "");
        const amt = Number((p as any).amount_centavos || 0);
        paymentsBySale.set(sid, (paymentsBySale.get(sid) || 0) + amt);
      }
    }

    // Customer payments recorded via recordPayment (payment_request_id present)
    const { data: customerPays, error: cpErr } = await supabase
      .from("payment_ledger")
      .select("payment_id,payment_request_id,created_at,method,amount_centavos,notes,created_by")
      .eq("store_id", store_id)
      .eq("customer_id", customer_id)
      .not("payment_request_id", "is", null)
      .eq("is_refund", false)
      .order("created_at", { ascending: false })
      .limit(300);
    if (cpErr) throw new Error(cpErr.message);

    // Cashier names (best-effort)
    const userIds = Array.from(
      new Set([
        ...(sales || []).map((s: any) => String(s.created_by || "")).filter(Boolean),
        ...(customerPays || []).map((p: any) => String(p.created_by || "")).filter(Boolean),
      ])
    );

    const nameByUserId = new Map<string, string>();
    if (userIds.length) {
      const { data: users, error: uErr } = await supabase
        .from("user_accounts")
        .select("user_id,full_name,email")
        .in("user_id", userIds);
      if (uErr) throw new Error(uErr.message);
      for (const u of users || []) {
        nameByUserId.set(String((u as any).user_id), String((u as any).full_name || (u as any).email || ""));
      }
    }

    const due_sales = (sales || []).map((s: any) => {
      const paid = paymentsBySale.get(String(s.sale_id)) || 0;
      const total = Number(s.total_centavos || 0);
      const balance_due = Math.max(0, total - Math.min(paid, total));
      return {
        sale_id: s.sale_id,
        status: s.status,
        sale_date: s.completed_at || s.created_at,
        receipt_number: s.receipt_number || null,
        total_centavos: total,
        amount_paid_centavos: paid,
        balance_due_centavos: balance_due,
        cashier_name: nameByUserId.get(String(s.created_by || "")) || "",
        client_tx_id: s.client_tx_id || null,
      };
    });

    const customer_payments = (customerPays || []).map((p: any) => ({
      payment_id: p.payment_id,
      payment_request_id: p.payment_request_id,
      created_at: p.created_at,
      method: p.method,
      amount_centavos: Number(p.amount_centavos || 0),
      note: p.notes || "",
      recorded_by_name: nameByUserId.get(String(p.created_by || "")) || "",
    }));

    return jsonOk({ customer_id, due_sales, customer_payments });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
