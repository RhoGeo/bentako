import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";

function toMs(d: any): number {
  try {
    return new Date(d).getTime();
  } catch (_e) {
    return 0;
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const store_id = body?.store_id;
    const window_days = Number(body?.window_days || 30);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);

    const now = Date.now();
    const cutoff = now - window_days * 24 * 60 * 60 * 1000;

    const sales = await base44.asServiceRole.entities.Sale.filter({ store_id });
    const monthly_sold_by_product: Record<string, number> = {};

    for (const s of sales || []) {
      const status = s.status;
      if (status !== "completed" && status !== "due") continue;
      const t = toMs(s.sale_date || s.created_at || s.created_date);
      if (!t || t < cutoff) continue;
      const items = Array.isArray(s.items) ? s.items : [];
      for (const it of items) {
        const pid = it?.product_id;
        const qty = Number(it?.qty || 0);
        if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
        monthly_sold_by_product[pid] = (monthly_sold_by_product[pid] || 0) + qty;
      }
    }

    return jsonOk({ window_days, monthly_sold_by_product });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
