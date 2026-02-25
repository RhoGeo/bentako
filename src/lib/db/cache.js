import { db, Dexie } from "./dexie";
import { normalizeBarcodeOrEmpty } from "@/lib/ids/deviceId";

/**
 * Offline-first barcode lookup.
 * MUST use Dexie compound index: [store_id+barcode]
 */
export async function getCachedProductByBarcode(store_id, barcode) {
  const bc = normalizeBarcodeOrEmpty(barcode);
  if (!store_id || !bc) return null;
  const row = await db.cached_products
    .where("[store_id+barcode]")
    .equals([store_id, bc])
    .first();
  return row?.snapshot_json || null;
}

function coerceUpdatedAt(v) {
  if (!v) return new Date().toISOString();
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return new Date().toISOString();
}

function toCachedProductRow(input, fallbackStoreId) {
  const snapshot = input?.snapshot || input;
  const store_id = snapshot?.store_id || fallbackStoreId;
  const product_id = input?.product_id || snapshot?.id;
  const updated_at = coerceUpdatedAt(
    input?.updated_at || snapshot?.updated_at || snapshot?.updated_date
  );
  const barcode = normalizeBarcodeOrEmpty(snapshot?.barcode || "");
  const name = (snapshot?.name || "").toString();
  return {
    store_id,
    product_id,
    barcode,
    name,
    snapshot_json: snapshot,
    updated_at,
  };
}

export async function upsertCachedProducts(products, store_id) {
  if (!Array.isArray(products) || products.length === 0) return;
  const rows = products
    .map((p) => toCachedProductRow(p, store_id))
    .filter((r) => r.store_id && r.product_id);
  if (rows.length === 0) return;
  await db.cached_products.bulkPut(rows);
}

function toCachedCustomerRow(input, fallbackStoreId) {
  const snapshot = input?.snapshot || input;
  const store_id = snapshot?.store_id || fallbackStoreId;
  const customer_id = input?.customer_id || snapshot?.id;
  const updated_at = coerceUpdatedAt(
    input?.updated_at || snapshot?.updated_at || snapshot?.updated_date
  );
  const name = (snapshot?.name || "").toString();
  return {
    store_id,
    customer_id,
    name,
    snapshot_json: snapshot,
    updated_at,
  };
}

export async function upsertCachedCustomers(customers, store_id) {
  if (!Array.isArray(customers) || customers.length === 0) return;
  const rows = customers
    .map((c) => toCachedCustomerRow(c, store_id))
    .filter((r) => r.store_id && r.customer_id);
  if (rows.length === 0) return;
  await db.cached_customers.bulkPut(rows);
}

function toCachedCategoryRow(input, fallbackStoreId) {
  const snapshot = input?.snapshot || input;
  const store_id = snapshot?.store_id || fallbackStoreId;
  const category_id = input?.category_id || snapshot?.id;
  const updated_at = coerceUpdatedAt(
    input?.updated_at || snapshot?.updated_at || snapshot?.updated_date
  );
  return {
    store_id,
    category_id,
    snapshot_json: snapshot,
    updated_at,
  };
}

export async function upsertCachedCategories(categories, store_id) {
  if (!Array.isArray(categories) || categories.length === 0) return;
  const rows = categories
    .map((c) => toCachedCategoryRow(c, store_id))
    .filter((r) => r.store_id && r.category_id);
  if (rows.length === 0) return;
  await db.cached_categories.bulkPut(rows);
}

export async function deleteCachedProductsByIds(store_id, productIds) {
  if (!store_id || !Array.isArray(productIds) || productIds.length === 0) return;
  const keys = productIds.map((id) => [store_id, id]);
  await db.cached_products.bulkDelete(keys);
}

export async function deleteCachedCustomersByIds(store_id, customerIds) {
  if (!store_id || !Array.isArray(customerIds) || customerIds.length === 0) return;
  const keys = customerIds.map((id) => [store_id, id]);
  await db.cached_customers.bulkDelete(keys);
}

export async function deleteCachedCategoriesByIds(store_id, categoryIds) {
  if (!store_id || !Array.isArray(categoryIds) || categoryIds.length === 0) return;
  const keys = categoryIds.map((id) => [store_id, id]);
  await db.cached_categories.bulkDelete(keys);
}

/**
 * Patch a cached product snapshot by store_id + product_id.
 */
export async function patchCachedProductSnapshot(store_id, product_id, nextSnapshot) {
  if (!store_id || !product_id || !nextSnapshot) return;
  const key = [store_id, product_id];
  const existing = await db.cached_products.get(key);
  const updated_at = new Date().toISOString();
  const barcode = normalizeBarcodeOrEmpty(
    nextSnapshot?.barcode || existing?.barcode || ""
  );
  const name = (nextSnapshot?.name || existing?.name || "").toString();
  await db.cached_products.put({
    store_id,
    product_id,
    barcode,
    name,
    snapshot_json: nextSnapshot,
    updated_at,
  });
}

export async function getAllCachedProducts(store_id) {
  if (!store_id) return [];
  const rows = await db.cached_products
    .where("[store_id+name]")
    .between([store_id, Dexie.minKey], [store_id, Dexie.maxKey])
    .toArray();
  return rows.map((r) => r.snapshot_json).filter(Boolean);
}

export async function getAllCachedCustomers(store_id) {
  if (!store_id) return [];
  const rows = await db.cached_customers
    .where("[store_id+name]")
    .between([store_id, Dexie.minKey], [store_id, Dexie.maxKey])
    .toArray();
  return rows.map((r) => r.snapshot_json).filter(Boolean);
}

/**
 * Patch a cached customer snapshot by store_id + customer_id.
 * Used for offline-first utang payment UX (Step 10).
 */
export async function patchCachedCustomerSnapshot(store_id, customer_id, nextSnapshot) {
  if (!store_id || !customer_id || !nextSnapshot) return;
  const key = [store_id, customer_id];
  const existing = await db.cached_customers.get(key);
  const updated_at = new Date().toISOString();
  const name = (nextSnapshot?.name || existing?.name || "").toString();
  await db.cached_customers.put({
    store_id,
    customer_id,
    name,
    snapshot_json: nextSnapshot,
    updated_at,
  });
}
