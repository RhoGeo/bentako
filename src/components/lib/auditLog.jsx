import { invokeFunction } from "@/api/posyncClient";
import { getActiveStoreId } from "@/components/lib/activeStore";
import { getDeviceId } from "@/lib/ids/deviceId";

/**
 * auditLog — Step 11
 * Writes ActivityEvent via backend function (custom auth).
 */
export async function auditLog(event_type, description, opts = {}) {
  const {
    reference_id,
    amount_centavos,
    actor_email,
    metadata,
    store_id: overrideStoreId,
  } = opts;
  const store_id = overrideStoreId || getActiveStoreId();
  if (!store_id) return;
  try {
    await invokeFunction("logActivityEvent", {
      store_id,
      event_type,
      description,
      entity_id: reference_id || null,
      amount_centavos: amount_centavos ?? null,
      device_id: getDeviceId(),
      metadata_json: {
        actor_email: actor_email || null,
        ...(metadata || {}),
      },
    });
  } catch (e) {
    console.warn("[auditLog] failed:", e);
  }
}