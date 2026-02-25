import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";

function cleanToken(v: any) {
  return String(v || "").trim();
}

/**
 * acceptStaffInvite
 * - User accepts an invite intended for their email.
 * - Creates/activates StaffMember membership in the target store.
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user?.email) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const invite_token = cleanToken(body?.invite_token);
    if (!invite_token) return jsonFail(400, "BAD_REQUEST", "invite_token required");

    let invite: any = null;
    try {
      const rows = await base44.asServiceRole.entities.StaffInvite.filter({ invite_token });
      invite = rows?.[0] || null;
    } catch (e) {
      return jsonFail(500, "SCHEMA_MISSING", "StaffInvite entity missing", { cause: String(e?.message || e) });
    }

    if (!invite) return jsonFail(404, "NOT_FOUND", "Invite not found");
    if (invite.status === "revoked") return jsonFail(403, "FORBIDDEN", "Invite revoked");
    if (invite.status === "accepted") {
      // Idempotent acceptance for the same email
      if (String(invite.invite_email || "").toLowerCase() === String(user.email).toLowerCase()) {
        return jsonOk({ store_id: invite.store_id, role: invite.role, idempotent: true });
      }
      return jsonFail(403, "FORBIDDEN", "Invite already used");
    }

    const expiresAt = invite.expires_at ? new Date(invite.expires_at).getTime() : 0;
    if (expiresAt && expiresAt < Date.now()) return jsonFail(403, "FORBIDDEN", "Invite expired");

    if (String(invite.invite_email || "").toLowerCase() !== String(user.email).toLowerCase()) {
      return jsonFail(403, "FORBIDDEN", "This invite is not for your email");
    }

    const store_id = invite.store_id;
    const role = String(invite.role || "cashier").toLowerCase();

    // Create or activate StaffMember
    const existing = await base44.asServiceRole.entities.StaffMember.filter({ store_id, user_email: user.email });
    if (existing?.[0]) {
      const currentRole = String(existing[0].role || "cashier").toLowerCase();
      await base44.asServiceRole.entities.StaffMember.update(existing[0].id, {
        is_active: true,
        // Never downgrade an existing owner
        role: currentRole === "owner" ? "owner" : role,
        user_name: existing[0].user_name || user.full_name || user.email,
      });
    } else {
      await base44.asServiceRole.entities.StaffMember.create({
        store_id,
        user_email: user.email,
        user_name: user.full_name || user.email,
        role,
        is_active: true,
        policy_acknowledged: false,
        created_at: new Date().toISOString(),
      });
    }

    // Mark invite accepted
    await base44.asServiceRole.entities.StaffInvite.update(invite.id, {
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by_email: user.email,
    });

    try {
      await base44.asServiceRole.entities.ActivityEvent.create({
        store_id,
        user_id: user.id || null,
        device_id: null,
        event_type: "staff_invite_accepted",
        entity_id: invite.id,
        metadata_json: { invite_email: user.email, role },
        created_at: new Date().toISOString(),
      });
    } catch (_e) {}

    return jsonOk({ store_id, role });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
