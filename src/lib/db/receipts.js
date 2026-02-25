import { db } from "./dexie";

export async function upsertLocalReceipt(receipt) {
  if (!receipt?.store_id || !receipt?.client_tx_id) {
    throw new Error("local_receipts requires store_id + client_tx_id");
  }
  const row = {
    store_id: receipt.store_id,
    client_tx_id: receipt.client_tx_id,
    local_status: receipt.local_status ?? receipt.status ?? "queued",
    server_sale_id: receipt.server_sale_id ?? null,
    server_receipt_number:
      receipt.server_receipt_number ?? receipt.receipt_number ?? null,
    last_error: receipt.last_error ?? null,
  };
  await db.local_receipts.put(row);
}

export async function getLocalReceipt(store_id, client_tx_id) {
  if (!store_id || !client_tx_id) return null;
  return (await db.local_receipts.get([store_id, client_tx_id])) || null;
}
