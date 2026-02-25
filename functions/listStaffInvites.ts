import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";

/**
 * listStaffInvites
 * - Owner/manager (if allowed) can view pending invites.
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
      permission: "staff_manage",
      pinSettingField: "pin_required_staff_manage",
      owner_pin_proof: null,
    });

    let invites: any[] = [];
    try {
      invites = await base44.asServiceRole.entities.StaffInvite.filter({ store_id, status: "pending" });
    } catch (e) {
      return jsonFail(500, "SCHEMA_MISSING", "StaffInvite entity missing", { cause: String(e?.message || e) });
    }

    const now = Date.now();
    const cleaned = (invites || [])
      .filter((i) => !i.expires_at || new Date(i.expires_at).getTime() > now)
      .sort((a, b) => new Date(b.created_at || b.created_date || 0).getTime() - new Date(a.created_at || a.created_date || 0).getTime())
      .slice(0, 50)
      .map((i) => ({
        id: i.id,
        invite_email: i.invite_email,
        role: i.role,
        status: i.status,
        expires_at: i.expires_at,
        created_at: i.created_at || i.created_date,
      }));

    return jsonOk({ invites: cleaned });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
