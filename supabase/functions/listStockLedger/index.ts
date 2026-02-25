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
    const product_id = str(body?.product_id);
    const reason = body?.reason != null ? str(body.reason) : "";
    const limit = Math.min(Math.max(int(body?.limit, 50), 1), 200);

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!product_id) return jsonFail(400, "BAD_REQUEST", "product_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "inventory_adjust_stock" });

    let q = supabase
      .from("stock_ledger")
      .select("stock_ledger_id,store_id,product_id,delta_qty,reason,mutation_key,notes,created_by,created_at")
      .eq("store_id", store_id)
      .eq("product_id", product_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (reason) q = q.eq("reason", reason);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows || []).map((r: any) => r.created_by).filter(Boolean)));
    let usersById: Record<string, any> = {};
    if (userIds.length) {
      const { data: users, error: uerr } = await supabase
        .from("user_accounts")
        .select("user_id,email")
        .in("user_id", userIds);
      if (uerr) throw new Error(uerr.message);
      for (const u of users || []) usersById[String(u.user_id)] = u;
    }

    const out = (rows || []).map((r: any) => ({
      ...r,
      created_by_email: usersById[String(r.created_by)]?.email || null,
    }));

    return jsonOk({ rows: out });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
