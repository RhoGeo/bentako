import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";
import { getStoreSettings } from "./_lib/storeSettings.ts";

/**
 * archiveStore
 * - Owner-only (or role override) action to hide a store from store pickers.
 * - Requires StoreSettings schema to include: is_archived:boolean, archived_at:string (optional).
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const { store_id } = body || {};
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "store_archive",
      pinSettingField: "pin_required_store_archive",
      owner_pin_proof: null,
    });

    const existing = await getStoreSettings(base44, store_id);
    if (!existing?.id) {
      return jsonFail(500, "SCHEMA_MISSING", "StoreSettings entity is missing or not writable");
    }

    try {
      await base44.asServiceRole.entities.StoreSettings.update(existing.id, {
        is_archived: true,
        archived_at: new Date().toISOString(),
      });
    } catch (e) {
      return jsonFail(500, "SCHEMA_MISSING", "Add StoreSettings.is_archived (boolean) in Base44 schema", { cause: String(e?.message || e) });
    }

    return jsonOk({ store_id, is_archived: true });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
