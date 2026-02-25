/**
 * POSync Offline DB (Dexie) — Step 4
 *
 * Tables + indexes MUST match prompt exactly:
 * - cached_products:   [store_id+product_id], [store_id+barcode], [store_id+name], updated_at
 * - cached_customers:  [store_id+customer_id], [store_id+name], updated_at
 * - cached_categories: [store_id+category_id], updated_at
 * - offline_queue:     event_id, [store_id+status], [store_id+created_at_device], client_tx_id
 * - local_meta:        [store_id+device_id]
 * - local_receipts:    [store_id+client_tx_id]
 */

import Dexie from "dexie";

export const db = new Dexie("posync_v2");

db.version(1).stores({
  cached_products:
    "[store_id+product_id],[store_id+barcode],[store_id+name],updated_at",
  cached_customers: "[store_id+customer_id],[store_id+name],updated_at",
  cached_categories: "[store_id+category_id],updated_at",
  offline_queue:
    "event_id,[store_id+status],[store_id+created_at_device],client_tx_id",
  local_meta: "[store_id+device_id]",
  local_receipts: "[store_id+client_tx_id]",
});

export { Dexie };
