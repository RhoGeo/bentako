import { getStoreSettings } from "./storeSettings.ts";

export type StockLedgerReason =
  | "sale"
  | "void"
  | "refund"
  | "restock"
  | "damaged"
  | "expired"
  | "lost"
  | "cycle_count"
  | "manual_correction"
  | "return_from_customer"
  | "return_to_supplier";

export const ADJUSTMENT_REASONS: ReadonlyArray<StockLedgerReason> = [
  "restock",
  "damaged",
  "expired",
  "lost",
  "cycle_count",
  "manual_correction",
  "return_from_customer",
  "return_to_supplier",
];

function nowIso() {
  return new Date().toISOString();
}

function mutationKey(args: { store_id: string; product_id: string; reference_type: string; reference_id: string }) {
  return `${args.store_id}::${args.product_id}::${args.reference_type}::${args.reference_id}`;
}

async function findLedgerByMutationKey(base44: any, store_id: string, key: string) {
  const rows = await base44.asServiceRole.entities.StockLedger.filter({ store_id, mutation_key: key });
  return rows?.[0] || null;
}

/**
 * Crash-safe stock update with ledger append.
 *
 * Atomicity strategy (no DB transactions available):
 * - Apply stock change + record pending mutation on Product
 * - Create StockLedger row with mutation_key
 * - Clear pending mutation best-effort
 * - Future calls finalize any pending mutation (idempotent)
 */
export async function applyStockDeltaWithLedger(
  base44: any,
  args: {
    store_id: string;
    product_id: string;
    delta_qty: number;
    reason: StockLedgerReason;
    reference_type: string;
    reference_id: string;
    device_id?: string | null;
    client_tx_id?: string | null;
    created_at_device?: number | null;
  }
): Promise<{ new_qty: number; tracked: boolean }> {
  const { store_id, product_id } = args;
  const key = mutationKey({
    store_id,
    product_id,
    reference_type: args.reference_type,
    reference_id: args.reference_id,
  });

  // If ledger exists, treat as applied.
  const existingLedger = await findLedgerByMutationKey(base44, store_id, key);
  if (existingLedger) {
    const resulting_qty = Number(existingLedger.resulting_qty ?? existingLedger.new_qty ?? 0);
    // Best-effort ensure product matches
    const products = await base44.asServiceRole.entities.Product.filter({ id: product_id, store_id });
    const p = products?.[0];
    if (p && Number(p.stock_quantity ?? p.stock_qty ?? 0) !== resulting_qty) {
      await base44.asServiceRole.entities.Product.update(product_id, {
        stock_quantity: resulting_qty,
        stock_qty: resulting_qty,
      });
    }
    return { new_qty: resulting_qty, tracked: !!p?.track_stock };
  }

  const products = await base44.asServiceRole.entities.Product.filter({ id: product_id, store_id });
  const product = products?.[0];
  if (!product) throw new Error(`Product not found: ${product_id}`);
  const tracked = product.track_stock !== false;
  if (!tracked) return { new_qty: Number(product.stock_quantity ?? product.stock_qty ?? 0), tracked: false };

  const prev_qty = Number(product.stock_quantity ?? product.stock_qty ?? 0);
  const new_qty = prev_qty + Number(args.delta_qty || 0);

  const settings = await getStoreSettings(base44, store_id);
  const allow_negative_stock = !!settings?.allow_negative_stock;
  if (!allow_negative_stock && new_qty < 0) {
    throw new Error("Negative stock not allowed");
  }

  const pending = Array.isArray(product.pending_stock_mutations) ? product.pending_stock_mutations : [];
  if (pending.some((m) => m?.mutation_key === key)) {
    // Stock already applied but ledger missing → create ledger now.
    await base44.asServiceRole.entities.StockLedger.create({
      store_id,
      product_id,
      mutation_key: key,
      qty_delta: Number(args.delta_qty || 0),
      prev_qty,
      resulting_qty: new_qty,
      reason: args.reason,
      reference_type: args.reference_type,
      reference_id: args.reference_id,
      device_id: args.device_id || null,
      client_tx_id: args.client_tx_id || null,
      created_at_device: args.created_at_device ?? null,
      created_at: nowIso(),
    });
    return { new_qty, tracked: true };
  }

  // Phase 1: apply stock + record pending mutation
  const pendingEntry = {
    mutation_key: key,
    qty_delta: Number(args.delta_qty || 0),
    prev_qty,
    resulting_qty: new_qty,
    reason: args.reason,
    reference_type: args.reference_type,
    reference_id: args.reference_id,
    created_at_device: args.created_at_device ?? null,
  };
  await base44.asServiceRole.entities.Product.update(product_id, {
    stock_quantity: new_qty,
    stock_qty: new_qty,
    pending_stock_mutations: [...pending, pendingEntry],
  });

  // Phase 2: append ledger
  await base44.asServiceRole.entities.StockLedger.create({
    store_id,
    product_id,
    mutation_key: key,
    qty_delta: Number(args.delta_qty || 0),
    prev_qty,
    resulting_qty: new_qty,
    reason: args.reason,
    reference_type: args.reference_type,
    reference_id: args.reference_id,
    device_id: args.device_id || null,
    client_tx_id: args.client_tx_id || null,
    created_at_device: args.created_at_device ?? null,
    created_at: nowIso(),
  });

  // Phase 3: clear pending best-effort
  try {
    const refreshed = await base44.asServiceRole.entities.Product.filter({ id: product_id, store_id });
    const p2 = refreshed?.[0];
    const p2Pending = Array.isArray(p2?.pending_stock_mutations) ? p2.pending_stock_mutations : [];
    await base44.asServiceRole.entities.Product.update(product_id, {
      pending_stock_mutations: p2Pending.filter((m) => m?.mutation_key !== key),
    });
  } catch (_e) {}

  return { new_qty, tracked: true };
}
