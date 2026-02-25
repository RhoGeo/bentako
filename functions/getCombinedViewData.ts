import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";

function getTimeMs(row: any): number {
  const t = new Date(row?.created_at || row?.created_date || row?.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * getCombinedViewData — Owner Combined View
 *
 * Input:
 * { store_ids: string[], from?: ISO, to?: ISO }
 *
 * Output:
 * { totals, per_store, recent_activity }
 */
export async function getCombinedViewData(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();

    const store_ids = Array.isArray(body?.store_ids) ? body.store_ids.map(String) : [];
    if (!store_ids.length) return jsonFail(400, "BAD_REQUEST", "store_ids required");

    const from = body?.from ? new Date(body.from) : new Date(new Date().toDateString());
    const to = body?.to ? new Date(body.to) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Must be owner on all stores
    for (const sid of store_ids) {
      const staff = await requireActiveStaff(base44, sid, user.email, user.role, user.full_name);
      requirePermission(staff, "reports_access");
      if (String(staff.role || "").toLowerCase() !== "owner") {
        return jsonFail(403, "FORBIDDEN", "Owner role required for Combined View");
      }
    }

    // Reuse getReportData logic by calling it internally would be nice, but Base44 function calls would be extra.
    // We compute a small set: revenue/tx/due per store + totals.
    const per_store = await Promise.all(
      store_ids.map(async (sid) => {
        let store: any = null;
        try {
          const s = await base44.asServiceRole.entities.Store.filter({ id: sid });
          store = s?.[0] || null;
        } catch (_e) {}

        const salesAll = await base44.asServiceRole.entities.Sale.filter({ store_id: sid });
        const sales = (salesAll || [])
          .filter((s: any) => {
            const t = new Date(s.sale_date || s.created_date || s.created_at).getTime();
            return t >= from.getTime() && t < to.getTime();
          })
          .filter((s: any) => s.status === "completed" || s.status === "due");

        const revenue_centavos = sales.reduce((sum: number, s: any) => sum + Number(s.total_centavos || 0), 0);
        const due_centavos = sales.reduce((sum: number, s: any) => sum + Number(s.balance_due_centavos || 0), 0);

        return {
          store_id: sid,
          store_name: store?.store_name || store?.name || "",
          sales_count: sales.length,
          revenue_centavos,
          due_centavos,
        };
      })
    );

    const totals = per_store.reduce(
      (acc: any, r: any) => {
        acc.sales_count += Number(r.sales_count || 0);
        acc.revenue_centavos += Number(r.revenue_centavos || 0);
        acc.due_centavos += Number(r.due_centavos || 0);
        return acc;
      },
      { from: from.toISOString(), to: to.toISOString(), sales_count: 0, revenue_centavos: 0, due_centavos: 0 }
    );

    // Recent Activity feed across stores
    const activityAll: any[] = [];
    for (const sid of store_ids) {
      try {
        const rows = await base44.asServiceRole.entities.ActivityEvent.filter({ store_id: sid });
        for (const r of rows || []) activityAll.push(r);
      } catch (_e) {}
    }
    const recent_activity = activityAll
      .sort((a, b) => getTimeMs(b) - getTimeMs(a))
      .slice(0, 80)
      .map((e: any) => ({
        activity_id: e.id,
        store_id: e.store_id,
        event_type: e.event_type,
        description: e.description || e.event_type,
        entity_id: e.entity_id || null,
        created_at: e.created_at || e.created_date || e.createdAt || null,
        metadata_json: e.metadata_json || null,
      }));

    return jsonOk({ totals, per_store, recent_activity });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(getCombinedViewData);
