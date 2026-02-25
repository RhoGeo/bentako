import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermissionOrOwnerPin } from "./_lib/guard.ts";

function cleanEmail(v: any) {
  return String(v || "").trim().toLowerCase();
}

function randomToken(lenBytes = 24) {
  const bytes = new Uint8Array(lenBytes);
  crypto.getRandomValues(bytes);
  // base64url
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * inviteStaff
 * - Creates a time-bound invite token for a specific email.
 * - Requires Base44 schema to include an entity: StaffInvite
 *
 * Required fields (minimum):
 *   store_id (string), invite_email (string), role (string), invite_token (string), status (string),
 *   invited_by_email (string), expires_at (string ISO), created_at (string ISO)
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const { store_id, invite_email, role } = body || {};
    if (!store_id || !invite_email) {
      return jsonFail(400, "BAD_REQUEST", "store_id and invite_email required");
    }
    const email = cleanEmail(invite_email);
    if (!email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Invalid email");
    const inviteRole = String(role || "cashier").toLowerCase();
    if (!["owner", "manager", "cashier"].includes(inviteRole)) {
      return jsonFail(400, "BAD_REQUEST", "Invalid role");
    }

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    await requirePermissionOrOwnerPin(base44, staff, {
      store_id,
      permission: "staff_manage",
      pinSettingField: "pin_required_staff_manage",
      owner_pin_proof: null,
    });

    // Idempotency: one pending invite per email per store.
    try {
      const existing = await base44.asServiceRole.entities.StaffInvite.filter({
        store_id,
        invite_email: email,
        status: "pending",
      });
      if (existing?.[0]) {
        return jsonOk({
          invite_id: existing[0].id,
          invite_email: email,
          role: existing[0].role,
          invite_token: existing[0].invite_token,
          expires_at: existing[0].expires_at,
          idempotent: true,
        });
      }
    } catch (_e) {
      // Schema missing
    }

    const token = randomToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    let created: any;
    try {
      created = await base44.asServiceRole.entities.StaffInvite.create({
        store_id,
        invite_email: email,
        role: inviteRole,
        invite_token: token,
        status: "pending",
        invited_by_email: user.email,
        expires_at: expires,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      return jsonFail(
        500,
        "SCHEMA_MISSING",
        "Create entity StaffInvite (see repo docs) to enable staff invites",
        { cause: String(e?.message || e) }
      );
    }

    try {
      await base44.asServiceRole.entities.ActivityEvent.create({
        store_id,
        user_id: user.id || null,
        device_id: null,
        event_type: "staff_invite_created",
        entity_id: created?.id,
        metadata_json: { invite_email: email, role: inviteRole },
        created_at: new Date().toISOString(),
      });
    } catch (_e) {}

    return jsonOk({
      invite_id: created?.id,
      invite_email: email,
      role: inviteRole,
      invite_token: token,
      expires_at: expires,
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
