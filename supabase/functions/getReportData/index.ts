import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonFailFromError, jsonOk } from "../_shared/response.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";

function parseIso(input: unknown, fallback: Date): Date {
  const s = String(input ?? "");
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

async function canAccessAllStores(user_id: string, store_ids: string[]) {
  for (const sid of store_ids) {
    await requireStoreAccess({ user_id, store_id: sid });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);
    const body = await req.json();

    const store_id = body?.store_id ? String(body.store_id) : null;
    const store_ids = Array.isArray(body?.store_ids) ? body.store_ids.map(String) : null;
    const include_drilldowns = !!body?.include_drilldowns;

    const from = parseIso(body?.from, new Date(Date.now() - 24 * 3600 * 1000));
    const to = parseIso(body?.to, new Date());

    const scope = store_ids && store_ids.length ? store_ids : (store_id ? [store_id] : []);
    if (scope.length === 0) return jsonFail(400, "BAD_REQUEST", "store_id or store_ids required");

    await canAccessAllStores(user.user_id, scope);

    // Sales summary
    const { data: sales, error: sErr } = await supabase
      .from("sales")
      .select("sale_id,store_id,total_centavos,created_at,status")
      .in("store_id", scope)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .in("status", ["completed", "due"]);

    if (sErr) throw new Error(sErr.message);

    const salesCount = (sales ?? []).length;
    const revenue = (sales ?? []).reduce((a: number, r: any) => a + Number(r.total_centavos || 0), 0);
    const avgBasket = salesCount ? Math.round(revenue / salesCount) : 0;

    // Gross profit + top products
    const saleIds = (sales ?? []).map((s: any) => s.sale_id);

    let grossProfit = 0;
    let topProducts: any[] = [];
    if (saleIds.length) {
      const { data: items, error: iErr } = await supabase
        .from("sale_items")
        .select("product_id,qty,unit_price_centavos,cost_price_snapshot_centavos,line_discount_centavos")
        .in("sale_id", saleIds);
      if (iErr) throw new Error(iErr.message);

      const agg = new Map<string, { qty: number; revenue: number }>();
      for (const it of items ?? []) {
        const qty = Number(it.qty || 0);
        const unit = Number(it.unit_price_centavos || 0);
        const disc = Number(it.line_discount_centavos || 0);
        const cost = Number(it.cost_price_snapshot_centavos || 0);
        const lineRev = Math.max(0, unit * qty - disc);
        const lineProfit = Math.max(0, (unit - cost) * qty - disc);
        grossProfit += lineProfit;
        const prev = agg.get(it.product_id) || { qty: 0, revenue: 0 };
        prev.qty += qty;
        prev.revenue += lineRev;
        agg.set(it.product_id, prev);
      }

      const productIds = Array.from(agg.keys());
      let nameById = new Map<string, string>();
      if (productIds.length) {
        const { data: prows, error: pErr } = await supabase
          .from("products")
          .select("product_id,name")
          .in("product_id", productIds);
        if (pErr) throw new Error(pErr.message);
        for (const p of prows ?? []) nameById.set(p.product_id, p.name);
      }

      topProducts = productIds
        .map((pid) => ({
          product_id: pid,
          product_name: nameById.get(pid) || null,
          qty: agg.get(pid)!.qty,
          revenue_centavos: Math.round(agg.get(pid)!.revenue),
        }))
        .sort((a, b) => b.revenue_centavos - a.revenue_centavos)
        .slice(0, 20);
    }

    // Inventory counts
    const { data: prods, error: prodErr } = await supabase
      .from("products")
      .select("product_id,store_id,is_parent,is_active,track_stock,stock_quantity,low_stock_threshold")
      .in("store_id", scope)
      .eq("is_active", true)
      .is("deleted_at", null);
    if (prodErr) throw new Error(prodErr.message);

    // Store settings for thresholds
    const { data: storeRows, error: stErr } = await supabase
      .from("stores")
      .select("store_id,low_stock_threshold_default,allow_negative_stock")
      .in("store_id", scope)
      .is("deleted_at", null);
    if (stErr) throw new Error(stErr.message);

    const storeDefaults = new Map<string, any>();
    for (const s of storeRows ?? []) storeDefaults.set(s.store_id, s);

    let totalSellable = 0;
    let tracked = 0;
    let low = 0;
    let out = 0;
    for (const p of prods ?? []) {
      if (p.is_parent) continue;
      totalSellable += 1;
      if (!p.track_stock) continue;
      tracked += 1;
      const qty = Number(p.stock_quantity ?? 0);
      const def = storeDefaults.get(p.store_id);
      const th = p.low_stock_threshold ?? def?.low_stock_threshold_default ?? 5;
      if (qty === 0) out += 1;
      else if (qty > 0 && qty <= th) low += 1;
    }

    const inventory = {
      total_sellable_items: totalSellable,
      tracked_items: tracked,
      low_stock_count: low,
      out_of_stock_count: out,
    };

    // Due aging (approx): use due sales created_at buckets
    const dueAging = { bucket_0_7_centavos: 0, bucket_8_30_centavos: 0, bucket_31_plus_centavos: 0 };
    const now = Date.now();
    for (const s of sales ?? []) {
      if (s.status !== "due") continue;
      const ageDays = Math.floor((now - new Date(s.created_at).getTime()) / (24 * 3600 * 1000));
      const amt = Number(s.total_centavos || 0);
      if (ageDays <= 7) dueAging.bucket_0_7_centavos += amt;
      else if (ageDays <= 30) dueAging.bucket_8_30_centavos += amt;
      else dueAging.bucket_31_plus_centavos += amt;
    }

    const perStore = scope.length > 1
      ? scope.map((sid) => {
          const storeSales = (sales ?? []).filter((r: any) => r.store_id === sid);
          const cnt = storeSales.length;
          const rev = storeSales.reduce((a: number, r: any) => a + Number(r.total_centavos || 0), 0);
          return { store_id: sid, sales_count: cnt, revenue_centavos: rev };
        })
      : [];

    const summary = {
      sales_count: salesCount,
      revenue_centavos: revenue,
      avg_basket_centavos: avgBasket,
      gross_profit_centavos: Math.round(grossProfit),
    };

    const drilldowns = include_drilldowns
      ? {
          per_store_sales_recent: scope.map((sid) => {
            const recent = (sales ?? [])
              .filter((r: any) => r.store_id === sid)
              .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .slice(0, 30)
              .map((r: any) => ({
                sale_id: r.sale_id,
                sale_date: r.created_at,
                total_centavos: r.total_centavos,
                status: r.status,
              }));
            return { store_id: sid, sales_recent: recent };
          }),
        }
      : undefined;

    return jsonOk({
      summary,
      top_products: topProducts,
      inventory,
      due_aging: dueAging,
      per_store: perStore,
      ...(include_drilldowns ? { drilldowns } : {}),
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
