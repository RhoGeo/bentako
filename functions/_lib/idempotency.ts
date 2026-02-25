export type IdempotencyKeyRecord = {
  id: string;
  store_id: string;
  key_type: string;
  key: string;
  status: "processing" | "applied" | "failed";
  result_json?: any;
  last_error?: string | null;
  created_at?: string;
};

export async function getIdempotencyRecord(base44: any, store_id: string, key_type: string, key: string): Promise<IdempotencyKeyRecord | null> {
  const results = await base44.asServiceRole.entities.IdempotencyKey.filter({ store_id, key_type, key });
  return results?.[0] || null;
}

export async function startIdempotentOperation(base44: any, store_id: string, key_type: string, key: string, meta?: Record<string, unknown>) {
  const existing = await getIdempotencyRecord(base44, store_id, key_type, key);
  if (existing && existing.status === "applied") {
    return { record: existing, duplicateApplied: true, appliedResult: existing.result_json };
  }
  if (existing && existing.status === "processing") {
    // treat as retryable duplicate
    return { record: existing, duplicateApplied: false };
  }
  const created = await base44.asServiceRole.entities.IdempotencyKey.create({
    store_id,
    key_type,
    key,
    status: "processing",
    meta: meta || null,
    created_at: new Date().toISOString(),
  });
  return { record: created, duplicateApplied: false };
}

export async function markIdempotentApplied(base44: any, recordId: string, result: unknown) {
  await base44.asServiceRole.entities.IdempotencyKey.update(recordId, {
    status: "applied",
    result_json: result,
    last_error: null,
    updated_at: new Date().toISOString(),
  });
}

export async function markIdempotentFailed(base44: any, recordId: string, message: string) {
  await base44.asServiceRole.entities.IdempotencyKey.update(recordId, {
    status: "failed",
    last_error: message,
    updated_at: new Date().toISOString(),
  });
}
