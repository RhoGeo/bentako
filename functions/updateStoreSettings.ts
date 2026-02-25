import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { getStoreSettings } from "./_lib/storeSettings.ts";
import { logActivityEvent } from "./_lib/activity.ts";

/**
 * updateStoreSettings — Step 11 support
 * Updates StoreSettings for non-sensitive configuration.
 */
export async function updateStoreSettings(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id } = body || {};
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "permissions_manage");

    const settings = await getStoreSettings(base44, store_id);

    // Whitelist allowed fields
    const allowedKeys = [
      "store_name",
      "address",
      "contact",
      "allow_negative_stock",
      "low_stock_threshold_default",
      "auto_sync_on_reconnect",
      "auto_sync_after_event",
      // PIN flags (stored in StoreSettings)
      "pin_required_void_refund",
      "pin_required_stock_adjust",
      "pin_required_export",
      "pin_required_device_revoke",
      "pin_required_discount_override",
      "pin_required_price_override",
    ];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const changed: string[] = [];
    for (const k of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        patch[k] = body[k];
        changed.push(k);
      }
    }

    if (!settings?.id) {
      await base44.asServiceRole.entities.StoreSettings.create({ store_id, ...patch, created_at: new Date().toISOString() });
    } else {
      await base44.asServiceRole.entities.StoreSettings.update(settings.id, patch);
    }

    await logActivityEvent(base44, {
      store_id,
      event_type: "store_settings_updated",
      description: "Store settings updated",
      entity_id: String(settings?.id || store_id),
      user_id: user.user_id,
      actor_email: user.email,
      metadata_json: { changed_keys: changed },
    });

    return jsonOk({ ok: true, changed_keys: changed });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(updateStoreSettings);
