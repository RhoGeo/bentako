import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";

/**
 * revokeStaffInvite
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const { store_id, invite_id } = body || {};
    if (!store_id || !invite_id) return jsonFail(400, "BAD_REQUEST", "store_id and invite_id required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "staff_manage",
      pinSettingField: "pin_required_staff_manage",
      owner_pin_proof: null,
    });

    try {
      await base44.asServiceRole.entities.StaffInvite.update(invite_id, {
        status: "revoked",
        revoked_at: new Date().toISOString(),
      });
    } catch (e) {
      return jsonFail(500, "SCHEMA_MISSING", "StaffInvite entity missing", { cause: String(e?.message || e) });
    }

    return jsonOk({ invite_id, revoked: true });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
