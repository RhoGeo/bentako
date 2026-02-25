import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { decodeCursor, encodeCursor } from "./_lib/cursor.ts";

function getUpdatedAt(obj: any): string {
  return (
    obj?.updated_at ||
    obj?.updated_date ||
    obj?.updatedAt ||
    obj?.created_at ||
    obj?.created_date ||
    new Date().toISOString()
  );
}

function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    const { store_id, device_id, cursor } = body || {};
    if (!store_id || !device_id) return jsonFail(400, "BAD_REQUEST", "store_id and device_id required");

    await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);

    const since = decodeCursor(cursor).t;
    const sinceMs = new Date(since).getTime();

    const safeFilter = async (entityName: string): Promise<any[]> => {
      try {
        const ent = base44?.asServiceRole?.entities?.[entityName];
        if (!ent?.filter) return [];
        return (await ent.filter({ store_id })) || [];
      } catch (_e) {
        return [];
      }
    };

    const [productsAll, customersAll, categoriesAll, settingsArr] = await Promise.all([
      safeFilter("Product"),
      safeFilter("Customer"),
      safeFilter("Category"),
      safeFilter("StoreSettings"),
    ]);

    const settings = settingsArr?.[0] || {};

    const products = (productsAll || []).filter(
      (p: any) => new Date(getUpdatedAt(p)).getTime() > sinceMs && p.is_active !== false
    );
    const customers = (customersAll || []).filter((c: any) => new Date(getUpdatedAt(c)).getTime() > sinceMs);
    const categories = (categoriesAll || []).filter((c: any) => new Date(getUpdatedAt(c)).getTime() > sinceMs);

    // Tombstones: Base44 doesn't provide hard-deletes, so we use is_active=false as deleted.
    const tombstonesProducts = (productsAll || [])
      .filter((p: any) => p.is_active === false && new Date(getUpdatedAt(p)).getTime() > sinceMs)
      .map((p: any) => p.id);

    const tombstonesCustomers: string[] = [];
    const tombstonesCategories: string[] = [];

    const updates = {
      products: products.map((p: any) => ({ product_id: p.id, updated_at: getUpdatedAt(p), snapshot: p })),
      customers: customers.map((c: any) => ({ customer_id: c.id, updated_at: getUpdatedAt(c), snapshot: c })),
      categories: categories.map((c: any) => ({ category_id: c.id, updated_at: getUpdatedAt(c), snapshot: c })),
      store_settings: settings || {},
      tombstones: {
        products: tombstonesProducts,
        customers: tombstonesCustomers,
        categories: tombstonesCategories,
      },
    };

    // Cursor safety: set to the MAX updated_at we actually observed, not "now".
    let maxSeen = since;
    for (const p of updates.products) maxSeen = maxIso(maxSeen, p.updated_at);
    for (const c of updates.customers) maxSeen = maxIso(maxSeen, c.updated_at);
    for (const c of updates.categories) maxSeen = maxIso(maxSeen, c.updated_at);
    if (settings?.updated_at) maxSeen = maxIso(maxSeen, String(settings.updated_at));

    const new_cursor = encodeCursor({ t: maxSeen });

    return jsonOk({ new_cursor, updates });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
