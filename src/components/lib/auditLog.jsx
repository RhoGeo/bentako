import { base44 } from "@/api/base44Client";

const STORE_ID = "default";

export async function auditLog(event_type, description, opts = {}) {
  const { reference_id, amount_centavos, actor_email, metadata } = opts;
  try {
    await base44.entities.ActivityEvent.create({
      store_id: STORE_ID,
      event_type,
      description,
      reference_id,
      amount_centavos,
      actor_email,
      metadata,
    });
  } catch (e) {
    console.warn("[auditLog] failed:", e);
  }
}