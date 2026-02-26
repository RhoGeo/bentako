import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { restGet } from "./_lib/supabaseAdmin.ts";

function clampInt(v: any, def: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function asIsoOrNull(v: any): string | null {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function buildInFilter(field: string, values: string[]) {
  const vals = uniq(values);
  if (!vals.length) return "";
  return `&${field}=in.(${vals.join(",")})`;
}

export async function listSales(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();

    const store_id = String(body?.store_id || "").trim();
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "reports_drilldowns");

    const fromIso = asIsoOrNull(body?.from) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const toIso = asIsoOrNull(body?.to);
    const limit = clampInt(body?.limit, 100, 1, 500);

    // 1) Sales rows
    const salesPath =
      `/rest/v1/sales` +
      `?select=sale_id,store_id,status,client_tx_id,device_id,receipt_number,customer_id,subtotal_centavos,discount_centavos,total_centavos,notes,created_at,completed_at,voided_at,refunded_at,created_by` +
      `&store_id=eq.${store_id}` +
      `&created_at=gte.${encodeURIComponent(fromIso)}` +
      (toIso ? `&created_at=lte.${encodeURIComponent(toIso)}` : ``) +
      `&order=created_at.desc` +
      `&limit=${limit}`;

    const salesRows: any[] = (await restGet<any[]>(salesPath)) || [];
    if (!salesRows.length) return jsonOk({ sales: [] });

    const saleIds = uniq(salesRows.map((s) => String(s.sale_id || "")));
    const userIds = uniq(salesRows.map((s) => String(s.created_by || "")));

    // 2) Cashier emails/names
    const userMap = new Map<string, { email?: string; full_name?: string }>();
    if (userIds.length) {
      const usersPath =
        `/rest/v1/user_accounts` +
        `?select=user_id,email,full_name` +
        buildInFilter("user_id", userIds);
      const users: any[] = (await restGet<any[]>(usersPath)) || [];
      for (const u of users) {
        userMap.set(String(u.user_id), { email: u.email, full_name: u.full_name });
      }
    }

    // 3) Payments aggregation (refundable = max(0, min(total, paid_raw) - refunded_raw))
    const paidBySale = new Map<string, number>();
    const refundedBySale = new Map<string, number>();
    if (saleIds.length) {
      const payPath =
        `/rest/v1/payment_ledger` +
        `?select=sale_id,amount_centavos,is_refund` +
        `&store_id=eq.${store_id}` +
        buildInFilter("sale_id", saleIds);
      const pays: any[] = (await restGet<any[]>(payPath)) || [];
      for (const p of pays) {
        const sid = String(p.sale_id || "");
        const amt = Number(p.amount_centavos || 0);
        if (!sid || !Number.isFinite(amt)) continue;
        if (p.is_refund) {
          refundedBySale.set(sid, (refundedBySale.get(sid) || 0) + amt);
        } else {
          paidBySale.set(sid, (paidBySale.get(sid) || 0) + amt);
        }
      }
    }

    const sales = salesRows.map((s) => {
      const sid = String(s.sale_id || "");
      const total = Number(s.total_centavos || 0);
      const paidRaw = paidBySale.get(sid) || 0;
      const refundedRaw = refundedBySale.get(sid) || 0;
      const refundable = Math.max(0, Math.min(total, paidRaw) - refundedRaw);

      const u = userMap.get(String(s.created_by || "")) || {};
      return {
        ...s,
        cashier_email: u.email || null,
        cashier_name: u.full_name || null,
        refundable_centavos: refundable,
      };
    });

    return jsonOk({ sales });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(listSales);
