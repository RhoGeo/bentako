import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { getStoreSettings } from "./_lib/storeSettings.ts";

function iso(d: Date) {
  return d.toISOString();
}

function rangeForPeriod(period?: string) {
  const now = new Date();
  const to = new Date(now.getTime() + 60 * 60 * 1000); // buffer
  const from = new Date(now);
  const p = String(period || "").toLowerCase();
  if (p === "today") {
    from.setHours(0, 0, 0, 0);
  } else if (p === "week") {
    from.setDate(from.getDate() - 7);
  } else if (p === "month") {
    from.setDate(from.getDate() - 30);
  } else {
    from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

function getTimeMs(row: any): number {
  const t = new Date(row?.sale_date || row?.created_date || row?.created_at || row?.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function ageDaysFrom(dateStr: any): number {
  if (!dateStr) return 0;
  const t = new Date(String(dateStr)).getTime();
  if (!Number.isFinite(t)) return 0;
  const diff = Date.now() - t;
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

/**
 * getReportData — Reports bundle.
 *
 * Supports:
 * - store scoped: { store_id }
 * - owner combined: { store_ids: [..] } (requires owner role on all stores)
 * - period convenience: { period: "today"|"week"|"month" }
 * - drilldowns: { include_drilldowns: true }
 */
export async function getReportData(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();

    const store_id = body?.store_id;
    const store_ids = Array.isArray(body?.store_ids) ? body.store_ids : null;
    const storeIds: string[] = store_ids?.length ? store_ids.map(String) : store_id ? [String(store_id)] : [];
    if (!storeIds.length) return jsonFail(400, "BAD_REQUEST", "store_id or store_ids required");

    const { from: fromDefault, to: toDefault } = rangeForPeriod(body?.period);
    const from = body?.from ? new Date(body.from) : fromDefault;
    const to = body?.to ? new Date(body.to) : toDefault;

    const includeDrilldowns = !!body?.include_drilldowns;

    // Permission checks per store
    const storeStaff = await Promise.all(
      storeIds.map(async (sid) => {
        const staff = await requireActiveStaff(base44, sid, user.email, user.role, user.full_name);
        requirePermission(staff, "reports_access");
        return { sid, staff };
      })
    );

    // Combined view is owner-only for safety.
    if (storeIds.length > 1) {
      const anyNonOwner = storeStaff.some(({ staff }) => String(staff.role || "").toLowerCase() !== "owner");
      if (anyNonOwner) return jsonFail(403, "FORBIDDEN", "Combined view requires Owner role on all stores");
    }

    const perStore = await Promise.all(
      storeIds.map(async (sid) => {
        const salesAll = await base44.asServiceRole.entities.Sale.filter({ store_id: sid });
        const salesInRange = (salesAll || []).filter((s: any) => {
          const t = getTimeMs(s);
          return t >= from.getTime() && t < to.getTime();
        });
        const sales = salesInRange.filter((s: any) => s.status === "completed" || s.status === "due");

        const saleIds = sales.map((s: any) => s.id);
        const saleItemsAll = saleIds.length
          ? await base44.asServiceRole.entities.SaleItem.filter({ store_id: sid })
          : [];
        const saleItems = (saleItemsAll || []).filter((it: any) => saleIds.includes(it.sale_id));

        const productsAll = await base44.asServiceRole.entities.Product.filter({ store_id: sid });
        const products = (productsAll || []).filter((p: any) => p.is_active !== false);
        const productMap = new Map(products.map((p: any) => [p.id, p]));

        const settings = await getStoreSettings(base44, sid);
        let store: any = null;
        try {
          const s = await base44.asServiceRole.entities.Store.filter({ id: sid });
          store = s?.[0] || null;
        } catch (_e) {}

        const defaultThresh = Number(store?.low_stock_threshold_default ?? settings?.low_stock_threshold_default ?? 5);
        const allowNegative = !!(store?.allow_negative_stock ?? settings?.allow_negative_stock);

        // Inventory
        const sellable = products.filter((p: any) => p.product_type !== "parent");
        const tracked = sellable.filter((p: any) => !!p.track_stock);
        const low_stock = tracked
          .map((p: any) => {
            const qty = Number(p.stock_quantity ?? 0);
            const thresh = Number(p.low_stock_threshold ?? defaultThresh);
            return { product_id: p.id, name: p.name || p.product_name || "", stock_quantity: qty, threshold: thresh };
          })
          .filter((p: any) => p.stock_quantity > 0 && p.stock_quantity <= p.threshold)
          .sort((a: any, b: any) => a.stock_quantity - b.stock_quantity);

        const out_of_stock = tracked
          .map((p: any) => ({
            product_id: p.id,
            name: p.name || p.product_name || "",
            stock_quantity: Number(p.stock_quantity ?? 0),
            threshold: Number(p.low_stock_threshold ?? defaultThresh),
          }))
          .filter((p: any) => p.stock_quantity === 0);

        const negative_stock = allowNegative
          ? tracked
              .map((p: any) => ({ product_id: p.id, name: p.name || p.product_name || "", stock_quantity: Number(p.stock_quantity ?? 0) }))
              .filter((p: any) => p.stock_quantity < 0)
          : [];

        // Sales summary
        const revenue = sales.reduce((sum: number, s: any) => sum + Number(s.total_centavos || 0), 0);
        const due = sales.reduce((sum: number, s: any) => sum + Number(s.balance_due_centavos || 0), 0);
        const sales_count = sales.length;
        const avg_basket_centavos = sales_count > 0 ? Math.round(revenue / sales_count) : 0;

        // Top products (revenue + profit)
        const byProduct: Record<string, { qty: number; revenue_centavos: number; profit_centavos: number }> = {};
        for (const it of saleItems) {
          const pid = String(it.product_id);
          const qty = Number(it.qty || 0);
          const unit = Number(it.unit_price_centavos || 0);
          const cost = Number(it.cost_price_snapshot_centavos || 0);
          const lineDisc = Number(it.line_discount_centavos || 0);
          if (!byProduct[pid]) byProduct[pid] = { qty: 0, revenue_centavos: 0, profit_centavos: 0 };
          byProduct[pid].qty += qty;
          byProduct[pid].revenue_centavos += qty * unit - lineDisc;
          byProduct[pid].profit_centavos += qty * (unit - cost) - lineDisc;
        }

        const top_products = Object.entries(byProduct)
          .map(([product_id, v]) => ({
            product_id,
            product_name: productMap.get(product_id)?.name || productMap.get(product_id)?.product_name || "",
            ...v,
          }))
          .sort((a, b) => b.revenue_centavos - a.revenue_centavos)
          .slice(0, 20);

        const gross_profit_centavos = top_products.reduce((s: number, p: any) => s + Number(p.profit_centavos || 0), 0);

        // Due aging buckets
        const customersAll = await base44.asServiceRole.entities.Customer.filter({ store_id: sid });
        const customersDue = (customersAll || []).filter((c: any) => Number(c.balance_due_centavos || 0) > 0 && c.is_active !== false);
        const buckets = { "0_7": 0, "8_30": 0, "31_plus": 0 };
        const due_customers = customersDue
          .map((c: any) => {
            const age =
              ageDaysFrom(c.last_payment_date) ||
              ageDaysFrom(c.last_transaction_date) ||
              ageDaysFrom(c.updated_at || c.updated_date) ||
              ageDaysFrom(c.created_at || c.created_date) ||
              0;
            const bal = Number(c.balance_due_centavos || 0);
            const bucket = age <= 7 ? "0_7" : age <= 30 ? "8_30" : "31_plus";
            buckets[bucket as keyof typeof buckets] += bal;
            return {
              customer_id: c.id,
              name: c.name || c.customer_name || "",
              phone: c.phone || c.phone_number || "",
              balance_due_centavos: bal,
              age_days: age,
              bucket,
            };
          })
          .sort((a: any, b: any) => b.balance_due_centavos - a.balance_due_centavos);

        // Cashier performance (permission gated client-side via financial_visibility)
        const byCashier = new Map<string, { cashier: string; tx: number; revenue_centavos: number }>();
        for (const s of sales) {
          const key = String(s.cashier_email || s.created_by_email || "unknown");
          const prev = byCashier.get(key) || { cashier: key, tx: 0, revenue_centavos: 0 };
          byCashier.set(key, {
            cashier: key,
            tx: prev.tx + 1,
            revenue_centavos: prev.revenue_centavos + Number(s.total_centavos || 0),
          });
        }
        const cashier_performance = Array.from(byCashier.values()).sort((a, b) => b.revenue_centavos - a.revenue_centavos);

        const sales_recent = includeDrilldowns
          ? sales
              .slice()
              .sort((a: any, b: any) => getTimeMs(b) - getTimeMs(a))
              .slice(0, 120)
              .map((s: any) => ({
                sale_id: s.id,
                sale_date: s.sale_date || s.created_date || s.created_at,
                total_centavos: Number(s.total_centavos || 0),
                status: s.status,
                cashier_email: s.cashier_email || s.created_by_email || "unknown",
                receipt_number: s.receipt_number || null,
                client_tx_id: s.client_tx_id || null,
              }))
          : [];

        const summary = {
          store_id: sid,
          store_name: store?.store_name || store?.name || "",
          from: iso(from),
          to: iso(to),
          sales_count,
          revenue_centavos: revenue,
          due_centavos: due,
          gross_profit_centavos,
          avg_basket_centavos,
        };

        return {
          store_id: sid,
          summary,
          top_products,
          inventory: {
            sellable_count: sellable.length,
            tracked_count: tracked.length,
            low_stock_count: low_stock.length,
            out_of_stock_count: out_of_stock.length,
            negative_stock_count: negative_stock.length,
            low_stock: includeDrilldowns ? low_stock : low_stock.slice(0, 15),
            out_of_stock: includeDrilldowns ? out_of_stock : out_of_stock.slice(0, 15),
            negative_stock: includeDrilldowns ? negative_stock : negative_stock.slice(0, 10),
            allow_negative_stock: allowNegative,
            default_threshold: defaultThresh,
          },
          due_aging: {
            buckets_centavos: buckets,
            due_customers: includeDrilldowns ? due_customers : due_customers.slice(0, 20),
          },
          cashier_performance: includeDrilldowns ? cashier_performance : cashier_performance.slice(0, 10),
          drilldowns: includeDrilldowns ? { sales_recent } : undefined,
        };
      })
    );

    // Aggregate across stores
    const summary = {
      from: iso(from),
      to: iso(to),
      sales_count: 0,
      revenue_centavos: 0,
      due_centavos: 0,
      gross_profit_centavos: 0,
      avg_basket_centavos: 0,
    };

    for (const r of perStore) {
      summary.sales_count += Number(r.summary.sales_count || 0);
      summary.revenue_centavos += Number(r.summary.revenue_centavos || 0);
      summary.due_centavos += Number(r.summary.due_centavos || 0);
      summary.gross_profit_centavos += Number(r.summary.gross_profit_centavos || 0);
    }
    summary.avg_basket_centavos = summary.sales_count > 0 ? Math.round(summary.revenue_centavos / summary.sales_count) : 0;

    // Aggregate top products across stores
    const topMap = new Map<string, any>();
    for (const r of perStore) {
      for (const p of r.top_products || []) {
        const id = String(p.product_id);
        const prev = topMap.get(id) || { product_id: id, product_name: p.product_name || "", qty: 0, revenue_centavos: 0, profit_centavos: 0 };
        topMap.set(id, {
          product_id: id,
          product_name: prev.product_name || p.product_name || "",
          qty: prev.qty + Number(p.qty || 0),
          revenue_centavos: prev.revenue_centavos + Number(p.revenue_centavos || 0),
          profit_centavos: prev.profit_centavos + Number(p.profit_centavos || 0),
        });
      }
    }
    const top_products = Array.from(topMap.values())
      .sort((a, b) => b.revenue_centavos - a.revenue_centavos)
      .slice(0, 20);

    const inventory = {
      sellable_count: 0,
      tracked_count: 0,
      low_stock_count: 0,
      out_of_stock_count: 0,
      negative_stock_count: 0,
      low_stock: [] as any[],
      out_of_stock: [] as any[],
    };

    const dueBuckets = { "0_7": 0, "8_30": 0, "31_plus": 0 };
    const dueCustomers: any[] = [];

    for (const r of perStore) {
      inventory.sellable_count += Number(r.inventory?.sellable_count || 0);
      inventory.tracked_count += Number(r.inventory?.tracked_count || 0);
      inventory.low_stock_count += Number(r.inventory?.low_stock_count || 0);
      inventory.out_of_stock_count += Number(r.inventory?.out_of_stock_count || 0);
      inventory.negative_stock_count += Number(r.inventory?.negative_stock_count || 0);

      for (const p of r.inventory?.low_stock || []) inventory.low_stock.push({ ...p, store_id: r.store_id });
      for (const p of r.inventory?.out_of_stock || []) inventory.out_of_stock.push({ ...p, store_id: r.store_id });

      const b = r.due_aging?.buckets_centavos || {};
      dueBuckets["0_7"] += Number(b["0_7"] || 0);
      dueBuckets["8_30"] += Number(b["8_30"] || 0);
      dueBuckets["31_plus"] += Number(b["31_plus"] || 0);
      for (const c of r.due_aging?.due_customers || []) dueCustomers.push({ ...c, store_id: r.store_id });
    }

    inventory.low_stock = inventory.low_stock.sort((a: any, b: any) => a.stock_quantity - b.stock_quantity).slice(0, includeDrilldowns ? 200 : 30);
    inventory.out_of_stock = inventory.out_of_stock.slice(0, includeDrilldowns ? 200 : 30);

    const due_aging = {
      buckets_centavos: dueBuckets,
      due_customers: dueCustomers
        .sort((a: any, b: any) => b.balance_due_centavos - a.balance_due_centavos)
        .slice(0, includeDrilldowns ? 200 : 30),
    };

    return jsonOk({
      summary,
      per_store: perStore.map((r) => r.summary),
      top_products,
      inventory,
      due_aging,
      cashier_performance:
        storeIds.length === 1
          ? perStore[0]?.cashier_performance || []
          : perStore.map((r) => ({ store_id: r.store_id, cashiers: r.cashier_performance || [] })),
      drilldowns:
        includeDrilldowns
          ? { per_store_sales_recent: perStore.map((r) => ({ store_id: r.store_id, sales_recent: r.drilldowns?.sales_recent || [] })) }
          : undefined,
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(getReportData);
