import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";

function iso(d: Date) {
  return d.toISOString();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const store_id = body?.store_id;
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "reports_access");

    const from = body?.from ? new Date(body.from) : new Date(new Date().toDateString());
    const to = body?.to ? new Date(body.to) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const sales = await base44.asServiceRole.entities.Sale.filter({ store_id });
    const inRange = (sales || []).filter((s: any) => {
      const t = new Date(s.sale_date || s.created_date || s.created_at).getTime();
      return t >= from.getTime() && t < to.getTime();
    });
    const completed = inRange.filter((s: any) => s.status === "completed" || s.status === "due");

    const revenue = completed.reduce((sum: number, s: any) => sum + Number(s.total_centavos || 0), 0);
    const due = completed.reduce((sum: number, s: any) => sum + Number(s.balance_due_centavos || 0), 0);

    // Top products by SaleItem
    const saleIds = completed.map((s: any) => s.id);
    const saleItems = saleIds.length
      ? await base44.asServiceRole.entities.SaleItem.filter({ store_id })
      : [];
    const itemsInRange = (saleItems || []).filter((it: any) => saleIds.includes(it.sale_id));
    const byProduct: Record<string, { qty: number; revenue_centavos: number; profit_centavos: number }> = {};
    for (const it of itemsInRange) {
      const pid = it.product_id;
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
      .map(([product_id, v]) => ({ product_id, ...v }))
      .sort((a, b) => b.revenue_centavos - a.revenue_centavos)
      .slice(0, 20);

    const summary = {
      from: iso(from),
      to: iso(to),
      sales_count: completed.length,
      revenue_centavos: revenue,
      due_centavos: due,
      gross_profit_centavos: top_products.reduce((s, p) => s + p.profit_centavos, 0),
    };

    return jsonOk({ summary, top_products });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
