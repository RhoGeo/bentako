export async function logActivity(base44: any, args: {
  store_id: string;
  event_type: string;
  description: string;
  actor_email?: string | null;
  device_id?: string | null;
  reference_id?: string | null;
  amount_centavos?: number | null;
  metadata_json?: Record<string, unknown> | null;
}) {
  try {
    await base44.asServiceRole.entities.ActivityEvent.create({
      store_id: args.store_id,
      event_type: args.event_type,
      description: args.description,
      actor_email: args.actor_email || null,
      device_id: args.device_id || null,
      reference_id: args.reference_id || null,
      amount_centavos: args.amount_centavos ?? null,
      metadata: args.metadata_json || null,
      created_at: new Date().toISOString(),
    });
  } catch (_e) {
    // don't block primary operation
  }
}
