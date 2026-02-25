import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin, requirePermission } from "./_lib/guard.ts";
import { logActivityEvent } from "./_lib/activity.ts";

/**
 * updateDevice — Step 11 (recommended)
 * Rename or revoke/allow a device. Revoke can be PIN-gated.
 */
export async function updateDevice(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id, device_row_id, status, device_name, owner_pin_proof } = body || {};
    if (!store_id || !device_row_id) return jsonFail(400, "BAD_REQUEST", "store_id and device_row_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "devices_manage");

    if (status && String(status) === "revoked") {
      await requirePermissionOrOwnerPin(base44, staff, {
        store_id,
        permission: "devices_manage",
        pinSettingField: "pin_required_device_revoke",
        owner_pin_proof,
      });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) {
      patch.status = String(status);
      // Back-compat boolean flag
      if (String(status) === "revoked") patch.allowed = false;
      if (String(status) === "allowed") patch.allowed = true;
    }
    if (device_name !== undefined) {
      patch.device_name = String(device_name);
      patch.name = String(device_name);
    }

    await base44.asServiceRole.entities.Device.update(device_row_id, patch);

    await logActivityEvent(base44, {
      store_id,
      event_type: status === "revoked" ? "device_revoked" : status === "allowed" ? "device_allowed" : "device_updated",
      description: status ? `Device status updated: ${status}` : "Device updated",
      entity_id: device_row_id,
      user_id: user.user_id,
      actor_email: user.email,
      metadata_json: { status: status ?? null, device_name: device_name ?? null },
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(updateDevice);
