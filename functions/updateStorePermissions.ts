import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { getStoreSettings } from "./_lib/storeSettings.ts";
import { logActivityEvent } from "./_lib/activity.ts";

/**
 * updateStorePermissions — Step 11
 * Updates store-level role permission templates and PIN gate flags.
 */
export async function updateStorePermissions(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const {
      store_id,
      role_permissions_manager_json,
      role_permissions_cashier_json,
      pin_required_void_refund,
      pin_required_stock_adjust,
      pin_required_device_revoke,
      pin_required_export,
      pin_required_discount_override,
      pin_required_price_override,
    } = body || {};

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "permissions_manage");

    const settings = await getStoreSettings(base44, store_id);
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    const maybeObj = (v: any) => (v && typeof v === "object") ? v : null;

    if (role_permissions_manager_json !== undefined) {
      patch.role_permissions_manager_json = maybeObj(role_permissions_manager_json);
      changed.push("role_permissions_manager_json");
    }
    if (role_permissions_cashier_json !== undefined) {
      patch.role_permissions_cashier_json = maybeObj(role_permissions_cashier_json);
      changed.push("role_permissions_cashier_json");
    }

    const boolField = (name: string, v: any) => {
      if (v === undefined) return;
      patch[name] = !!v;
      changed.push(name);
    };
    boolField("pin_required_void_refund", pin_required_void_refund);
    boolField("pin_required_stock_adjust", pin_required_stock_adjust);
    boolField("pin_required_device_revoke", pin_required_device_revoke);
    boolField("pin_required_export", pin_required_export);
    boolField("pin_required_discount_override", pin_required_discount_override);
    boolField("pin_required_price_override", pin_required_price_override);

    if (!settings?.id) {
      // getStoreSettings creates defaults best-effort; but guard anyway
      await base44.asServiceRole.entities.StoreSettings.create({ store_id, ...patch, created_at: new Date().toISOString() });
    } else {
      await base44.asServiceRole.entities.StoreSettings.update(settings.id, {
        ...patch,
        updated_at: new Date().toISOString(),
      });
    }

    await logActivityEvent(base44, {
      store_id,
      event_type: "permissions_updated",
      description: `Store permissions updated (${changed.length} fields)` ,
      entity_id: String(settings?.id || store_id),
      user_id: user.user_id,
      actor_email: user.email,
      device_id: null,
      metadata_json: { changed_keys: changed },
    });

    return jsonOk({ ok: true, changed_keys: changed });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(updateStorePermissions);
