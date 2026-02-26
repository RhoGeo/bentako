import { corsHeaders } from "../_shared/cors.ts";
import { jsonOk } from "../_shared/response.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import {
  productRowToSnapshot,
  customerRowToSnapshot,
  categoryRowToSnapshot,
  type DbProductRow,
  type DbCustomerRow,
  type DbCategoryRow,
} from "../_shared/snapshots.ts";

function parseCursor(cursor: unknown): string {
  if (!cursor) return new Date(0).toISOString();
  if (typeof cursor !== "string") return new Date(0).toISOString();

  // Accept raw ISO or legacy base64({t:iso})
  const s = cursor.trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  try {
    const decoded = atob(s);
    const obj = JSON.parse(decoded);
    const t = String(obj?.t || "");
    const dd = new Date(t);
    if (!isNaN(dd.getTime())) return dd.toISOString();
  } catch (_e) {
    // ignore
  }
  return new Date(0).toISOString();
}

function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user, session } = await requireAuth(req);

    const body = await req.json();
    const store_id = String(body?.store_id || "").trim();
    const device_id = String(body?.device_id || "").trim();
    const cursor = body?.cursor ?? null;

    if (!store_id || !device_id) throw new Error("store_id and device_id required");

    await requireStoreAccess({ user_id: user.user_id, store_id });

    if (String(session.device_id) !== String(device_id)) {
      throw new Error("FORBIDDEN");
    }

    const since = parseCursor(cursor);

    // Products (include parents + variants)
    const { data: productsAll, error: pErr } = await supabase
      .from("products")
      .select(
        "product_id,store_id,is_parent,parent_product_id,name,barcode,price_centavos,cost_price_centavos,track_stock,stock_quantity,low_stock_threshold,is_active,created_at,updated_at,deleted_at,category:categories(name),parent:products!parent_product_id(name)"
      )
      .eq("store_id", store_id)
      .gt("updated_at", since)
      .limit(5000);

    if (pErr) throw new Error(pErr.message);

    const productsRows = (productsAll || []) as any as DbProductRow[];
    const products = productsRows
      .filter((p) => p.deleted_at === null)
      .filter((p) => p.is_active !== false)
      .map((p) => ({
        product_id: p.product_id,
        updated_at: p.updated_at,
        snapshot: productRowToSnapshot(p),
      }));

    const tombstonesProducts = productsRows
      .filter((p) => p.deleted_at !== null || p.is_active === false)
      .map((p) => p.product_id);

    // Customers
    const { data: customersAll, error: cErr } = await supabase
      .from("customers")
      .select(
        "customer_id,store_id,name,phone,address,allow_utang,credit_limit_centavos,balance_due_centavos,notes,last_transaction_date,created_at,updated_at,deleted_at"
      )
      .eq("store_id", store_id)
      .gt("updated_at", since)
      .limit(5000);

    if (cErr) throw new Error(cErr.message);

    const custRows = (customersAll || []) as any as DbCustomerRow[];
    const customers = custRows
      .filter((c) => c.deleted_at === null)
      .map((c) => ({
        customer_id: c.customer_id,
        updated_at: c.updated_at,
        snapshot: customerRowToSnapshot(c),
      }));

    const tombstonesCustomers = custRows
      .filter((c) => c.deleted_at !== null)
      .map((c) => c.customer_id);

    // Categories
    const { data: categoriesAll, error: catErr } = await supabase
      .from("categories")
      .select("category_id,store_id,name,sort_order,is_active,created_at,updated_at,deleted_at")
      .eq("store_id", store_id)
      .gt("updated_at", since)
      .limit(5000);

    if (catErr) throw new Error(catErr.message);

    const catRows = (categoriesAll || []) as any as DbCategoryRow[];
    const categories = catRows
      .filter((c) => c.deleted_at === null)
      .filter((c) => c.is_active !== false)
      .map((c) => ({
        category_id: c.category_id,
        updated_at: c.updated_at,
        snapshot: categoryRowToSnapshot(c),
      }));

    const tombstonesCategories = catRows
      .filter((c) => c.deleted_at !== null || c.is_active === false)
      .map((c) => c.category_id);

    // Store settings
    const { data: store, error: sErr } = await supabase
      .from("stores")
      .select("store_id,store_name,store_settings_json,low_stock_threshold_default,allow_negative_stock,owner_pin_hash,updated_at")
      .eq("store_id", store_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);

    const { data: referral, error: rErr } = await supabase
      .from("store_referrals")
      .select("referral_discount_percent")
      .eq("store_id", store_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);

    const store_settings = store
      ? {
          ...(store.store_settings_json || {}),
          store_name: store.store_name,
          low_stock_threshold_default: store.low_stock_threshold_default,
          allow_negative_stock: store.allow_negative_stock,
          owner_pin_hash: store.owner_pin_hash,
          referral_discount_percent: referral?.referral_discount_percent || 0,
        }
      : {};

    const updates = {
      products,
      customers,
      categories,
      store_settings,
      tombstones: {
        products: tombstonesProducts,
        customers: tombstonesCustomers,
        categories: tombstonesCategories,
      },
    };

    // Cursor safety: advance to max updated_at seen (including store row)
    let maxSeen = since;
    for (const p of products) maxSeen = maxIso(maxSeen, p.updated_at);
    for (const c of customers) maxSeen = maxIso(maxSeen, c.updated_at);
    for (const c of categories) maxSeen = maxIso(maxSeen, c.updated_at);
    if (store?.updated_at) maxSeen = maxIso(maxSeen, String(store.updated_at));

    const new_cursor = maxSeen;

    return jsonOk({ new_cursor, updates });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
