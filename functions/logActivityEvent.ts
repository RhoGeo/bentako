import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { logActivityEvent as writeAudit } from "./_lib/activity.ts";

/**
 * logActivityEvent — client-initiated audit log entry.
 * Used for UI actions not wrapped by a dedicated backend function (e.g. product edits).
 */
export async function logActivityEvent(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id, event_type, description, entity_id, metadata_json, amount_centavos, device_id } = body || {};
    if (!store_id || !event_type) {
      return jsonFail(400, "BAD_REQUEST", "store_id and event_type required");
    }

    // Must be an active staff/member of the store.
    await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);

    await writeAudit(base44, {
      store_id,
      event_type: String(event_type),
      description: String(description || ""),
      entity_id: entity_id ? String(entity_id) : null,
      user_id: user.user_id,
      actor_email: user.email,
      device_id: device_id ? String(device_id) : null,
      amount_centavos: amount_centavos !== undefined && amount_centavos !== null ? Number(amount_centavos) : null,
      metadata_json: (metadata_json && typeof metadata_json === "object") ? metadata_json : null,
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(logActivityEvent);
