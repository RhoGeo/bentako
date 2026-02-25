import type { ApiError } from "./response.ts";

export type SyncEventType =
  | "completeSale"
  | "parkSale"
  | "voidSale"
  | "refundSale"
  | "adjustStock"
  | "recordPayment"
  | "restockProduct";

export type OfflineEventEnvelope = {
  event_id: string;
  store_id: string;
  device_id: string;
  client_tx_id?: string | null;
  event_type: SyncEventType | string;
  payload: any;
  created_at_device: number;
  // client-managed fields (accepted but not required by server)
  attempt_count?: number;
  status?: string;
  last_error?: unknown;
};

export type PushSyncEventsInput = {
  store_id: string;
  device_id: string;
  events: OfflineEventEnvelope[];
};

export type PushSyncEventResult = {
  event_id: string;
  status: "applied" | "duplicate_ignored" | "failed_retry" | "failed_permanent";
  data?: any;
  error?: ApiError;
};

export type PushSyncEventsOutput = {
  results: PushSyncEventResult[];
  server_time: number;
};

export type PullSyncEventsInput = {
  store_id: string;
  device_id: string;
  cursor?: string | null;
};

export type PullUpdateRow = { updated_at: string; snapshot: any };

export type PullSyncEventsOutput = {
  new_cursor: string;
  updates: {
    products: Array<{ product_id: string } & PullUpdateRow>;
    customers: Array<{ customer_id: string } & PullUpdateRow>;
    categories: Array<{ category_id: string } & PullUpdateRow>;
    store_settings: any;
    tombstones: {
      products: string[];
      customers: string[];
      categories: string[];
    };
  };
};

export function assertPushBody(body: any): asserts body is PushSyncEventsInput {
  if (!body?.store_id || !body?.device_id || !Array.isArray(body?.events) || body.events.length === 0) {
    throw Object.assign(new Error("store_id, device_id, events[] required"), { code: "BAD_REQUEST" });
  }
}

export function assertEventEnvelope(ev: any, expected: { store_id: string; device_id: string }) {
  if (!ev?.event_id || !ev?.event_type) {
    throw Object.assign(new Error("event_id and event_type required"), { code: "BAD_REQUEST" });
  }
  if (ev.store_id !== expected.store_id || ev.device_id !== expected.device_id) {
    throw Object.assign(new Error("store_id/device_id mismatch"), { code: "BAD_REQUEST" });
  }
  if (!Number.isFinite(Number(ev.created_at_device))) {
    throw Object.assign(new Error("created_at_device must be a number"), { code: "BAD_REQUEST" });
  }
  if (ev.payload === undefined) {
    throw Object.assign(new Error("payload required"), { code: "BAD_REQUEST" });
  }
}

export function requireClientTxId(ev: any): string {
  const top = ev?.client_tx_id;
  const nested = ev?.payload?.client_tx_id;
  const id = String(top || nested || "");
  if (!id) {
    throw Object.assign(new Error("client_tx_id required for sale-type events"), { code: "BAD_REQUEST" });
  }
  if (top && nested && String(top) !== String(nested)) {
    throw Object.assign(new Error("client_tx_id mismatch (envelope vs payload)"), { code: "BAD_REQUEST" });
  }
  return id;
}
