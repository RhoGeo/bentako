import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

function int(v: unknown, dflt: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();

    const store_id = str(body?.store_id);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "reports_access" });

    const from = body?.from ? new Date(String(body.from)) : null;
    const to = body?.to ? new Date(String(body.to)) : null;
    const limit = Math.min(Math.max(int(body?.limit, 100), 1), 500);

    let q = supabase
      .from("sales")
      .select(
        "sale_id,store_id,client_tx_id,receipt_number,status,total_centavos,created_by,created_at,completed_at,voided_at,refunded_at,customer_id",
      )
      .eq("store_id", store_id)
      .is("deleted_at", null)
      .neq("status", "parked")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (from && !isNaN(from.getTime())) {
      q = q.gte("created_at", from.toISOString());
    }
    if (to && !isNaN(to.getTime())) {
      q = q.lte("created_at", to.toISOString());
    }

    const { data: sales, error } = await q;
    if (error) throw new Error(error.message);

    const saleIds = (sales || []).map((s: any) => s.sale_id).filter(Boolean);

    // Payment summaries (avoid N+1): net paid is capped at total; refundable subtracts refunds already recorded.
    let paidBySale: Record<string, number> = {};
    let refundedBySale: Record<string, number> = {};
    if (saleIds.length) {
      const { data: pays, error: perr } = await supabase
        .from("payment_ledger")
        .select("sale_id,amount_centavos,is_refund")
        .eq("store_id", store_id)
        .in("sale_id", saleIds);
      if (perr) throw new Error(perr.message);
      for (const p of pays || []) {
        const sid = String((p as any).sale_id);
        const amt = Number((p as any).amount_centavos || 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        if ((p as any).is_refund) refundedBySale[sid] = (refundedBySale[sid] || 0) + amt;
        else paidBySale[sid] = (paidBySale[sid] || 0) + amt;
      }
    }

    const userIds = Array.from(new Set((sales || []).map((s: any) => s.created_by).filter(Boolean)));
    let usersById: Record<string, any> = {};
    if (userIds.length) {
      const { data: users, error: uerr } = await supabase
        .from("user_accounts")
        .select("user_id,email")
        .in("user_id", userIds);
      if (uerr) throw new Error(uerr.message);
      for (const u of users || []) usersById[String(u.user_id)] = u;
    }

    const out = (sales || []).map((s: any) => {
      const sid = String(s.sale_id);
      const total = Number(s.total_centavos || 0);
      const paidRaw = Number(paidBySale[sid] || 0);
      const refundedRaw = Number(refundedBySale[sid] || 0);
      const paidNet = Math.max(0, Math.min(total, paidRaw));
      const refundable = Math.max(0, paidNet - refundedRaw);
      return {
        ...s,
        cashier_email: usersById[String(s.created_by)]?.email || null,
        amount_paid_centavos: paidNet,
        refunded_centavos: refundedRaw,
        refundable_centavos: refundable,
      };
    });

    return jsonOk({ sales: out });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
