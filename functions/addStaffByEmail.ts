import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { normalizeEmail } from "./_lib/authNormalization.ts";
import { logActivityEvent } from "./_lib/activity.ts";

/**
 * addStaffByEmail — Step 11
 * Adds an existing user (by email) to the store as a StoreMembership.
 */
export async function addStaffByEmail(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id, user_email, role } = body || {};
    if (!store_id || !user_email || !role) {
      return jsonFail(400, "BAD_REQUEST", "store_id, user_email, role required");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "staff_manage");

    const { email_canonical } = normalizeEmail(user_email);
    const users = await base44.asServiceRole.entities.UserAccount.filter({ email_canonical });
    const target = users?.[0];
    if (!target) return jsonFail(404, "USER_NOT_FOUND", "User not found. Ask them to sign up first.");

    const existing = await base44.asServiceRole.entities.StoreMembership.filter({ store_id, user_id: target.user_id, is_active: true });
    if (existing?.[0]) {
      return jsonOk({ membership: existing[0], already_member: true });
    }

    const now = new Date().toISOString();
    const nextRole = String(role).toLowerCase();
    if (!["owner", "manager", "cashier"].includes(nextRole)) {
      return jsonFail(400, "BAD_REQUEST", "Invalid role");
    }

    const membership = await base44.asServiceRole.entities.StoreMembership.create({
      store_id,
      user_id: target.user_id,
      user_email: target.email,
      user_name: target.full_name,
      role: nextRole,
      overrides_json: {},
      is_active: true,
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
    });

    // Back-compat StaffMember
    try {
      await base44.asServiceRole.entities.StaffMember.create({
        store_id,
        user_email: target.email,
        user_name: target.full_name,
        role: nextRole,
        overrides_json: {},
        is_active: true,
        created_at: now,
      });
    } catch (_e) {}

    await logActivityEvent(base44, {
      store_id,
      event_type: "member_added",
      description: `Member added: ${target.email} (${nextRole})`,
      entity_id: membership.id,
      user_id: user.user_id,
      actor_email: user.email,
      metadata_json: { target_user_id: target.user_id, target_email: target.email, role: nextRole },
    });

    return jsonOk({ membership });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(addStaffByEmail);
