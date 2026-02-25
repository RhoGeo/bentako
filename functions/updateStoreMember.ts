import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { logActivityEvent } from "./_lib/activity.ts";

/**
 * updateStoreMember — Step 11
 * Updates role and/or overrides_json for a StoreMembership.
 */
export async function updateStoreMember(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id, membership_id, role, overrides_json, is_active } = body || {};

    if (!store_id || !membership_id) {
      return jsonFail(400, "BAD_REQUEST", "store_id and membership_id required");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "staff_manage");

    const rows = await base44.asServiceRole.entities.StoreMembership.filter({ id: membership_id, store_id });
    const m = rows?.[0];
    if (!m) return jsonFail(404, "NOT_FOUND", "Membership not found");

    // Prevent removing the last owner.
    const activeOwners = await base44.asServiceRole.entities.StoreMembership.filter({ store_id, role: "owner", is_active: true });
    const isLastOwner = m.role === "owner" && (activeOwners?.length || 0) <= 1;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const changed: string[] = [];

    if (role !== undefined && role !== null) {
      const nextRole = String(role).toLowerCase();
      if (!["owner", "manager", "cashier"].includes(nextRole)) {
        return jsonFail(400, "BAD_REQUEST", "Invalid role");
      }
      if (isLastOwner && nextRole !== "owner") {
        return jsonFail(400, "BAD_REQUEST", "Cannot demote last owner");
      }
      patch.role = nextRole;
      changed.push("role");
    }

    if (overrides_json !== undefined) {
      patch.overrides_json = (overrides_json && typeof overrides_json === "object") ? overrides_json : {};
      changed.push("overrides_json");
    }

    if (is_active !== undefined) {
      const nextActive = !!is_active;
      if (!nextActive && isLastOwner) {
        return jsonFail(400, "BAD_REQUEST", "Cannot deactivate last owner");
      }
      patch.is_active = nextActive;
      changed.push("is_active");
    }

    await base44.asServiceRole.entities.StoreMembership.update(membership_id, patch);

    // Back-compat: keep StaffMember in sync (best-effort)
    try {
      const sm = await base44.asServiceRole.entities.StaffMember.filter({ store_id, user_email: m.user_email });
      if (sm?.[0]?.id) {
        const smPatch: any = {};
        if (patch.role !== undefined) smPatch.role = patch.role;
        if (patch.overrides_json !== undefined) smPatch.overrides_json = patch.overrides_json;
        if (patch.is_active !== undefined) smPatch.is_active = patch.is_active;
        await base44.asServiceRole.entities.StaffMember.update(sm[0].id, smPatch);
      }
    } catch (_e) {}

    await logActivityEvent(base44, {
      store_id,
      event_type: "member_updated",
      description: `Store member updated (${changed.join(", ")})`,
      entity_id: membership_id,
      user_id: user.user_id,
      actor_email: user.email,
      metadata_json: { target_user_id: m.user_id, target_email: m.user_email, changed_keys: changed },
    });

    return jsonOk({ ok: true, changed_keys: changed });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(updateStoreMember);
