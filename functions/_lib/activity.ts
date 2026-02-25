/**
 * ActivityEvent audit logging (Step 11).
 *
 * NOTE: Base44 entity field names may vary by deployment.
 * We only write widely-used fields and embed the full audit payload in `metadata`.
 */

import { assertRequiredEntitiesExist } from "./schemaVerify.ts";

export type ActivityLogInput = {
  store_id: string;
  event_type: string;
  description: string;
  entity_id?: string | null;
  user_id?: string | null;
  actor_email?: string | null;
  device_id?: string | null;
  amount_centavos?: number | null;
  metadata_json?: Record<string, unknown> | null;
};

export async function logActivityEvent(base44: any, input: ActivityLogInput): Promise<void> {
  if (!input?.store_id || !input?.event_type) return;
  try {
    assertRequiredEntitiesExist(base44, ["ActivityEvent"]);
  } catch (_e) {
    return;
  }

  const nowIso = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    user_id: input.user_id ?? null,
    device_id: input.device_id ?? null,
    ...(input.metadata_json || {}),
  };

  // Best-effort: use common columns where they exist.
  try {
    await base44.asServiceRole.entities.ActivityEvent.create({
      store_id: input.store_id,
      event_type: input.event_type,
      description: input.description || "",
      reference_id: input.entity_id ?? null,
      amount_centavos: input.amount_centavos ?? null,
      actor_email: input.actor_email ?? null,
      metadata,
      created_at: nowIso,
    });
  } catch (_e) {
    // swallow – audit is best-effort; core business actions must not fail
  }
}
