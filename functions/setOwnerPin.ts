import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { getStoreSettings } from "./_lib/storeSettings.ts";
import { logActivityEvent } from "./_lib/activity.ts";

/**
 * setOwnerPin — Step 11
 * Sets StoreSettings.owner_pin_hash.
 * Client provides a SHA-256 hash string (proof format used by OwnerPinModal).
 */
export async function setOwnerPin(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id, owner_pin_hash } = body || {};
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "permissions_manage");

    const settings = await getStoreSettings(base44, store_id);

    const hash = owner_pin_hash === null || owner_pin_hash === undefined
      ? null
      : String(owner_pin_hash).trim();

    if (!settings?.id) {
      await base44.asServiceRole.entities.StoreSettings.create({ store_id, owner_pin_hash: hash, created_at: new Date().toISOString() });
    } else {
      await base44.asServiceRole.entities.StoreSettings.update(settings.id, { owner_pin_hash: hash, updated_at: new Date().toISOString() });
    }

    await logActivityEvent(base44, {
      store_id,
      event_type: "owner_pin_updated",
      description: hash ? "Owner PIN set/updated" : "Owner PIN cleared",
      entity_id: String(settings?.id || store_id),
      user_id: user.user_id,
      actor_email: user.email,
      device_id: null,
      metadata_json: { changed_keys: ["owner_pin_hash"], action: hash ? "set" : "cleared" },
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(setOwnerPin);
