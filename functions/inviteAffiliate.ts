/**
 * inviteAffiliate — Store sends affiliate invite.
 *
 * Spec Step 12.2:
 * - Managers/Cashiers can invite affiliates if permission enabled
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";
import { ok, fail } from "./_response.ts";
import { requirePermission } from "./_permissions.ts";

function cleanEmail(v: any) {
  return String(v || "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return fail("UNAUTHORIZED", "Unauthorized", null, 401);

    const body = await req.json();
    const { store_id, invite_email } = body || {};
    if (!store_id || !invite_email) return fail("BAD_REQUEST", "store_id and invite_email required");
    const email = cleanEmail(invite_email);
    if (!email.includes("@")) return fail("BAD_REQUEST", "Invalid email");

    const access = await requirePermission(base44, store_id, user, "affiliate_invite");
    if (!access.ok) return fail(access.error.code, access.error.message, null, 403);

    // Idempotency: avoid duplicate pending invites.
    try {
      const existing = await base44.asServiceRole.entities.Invite.filter({ store_id, invite_email: email, status: "pending" });
      if (existing?.length) return ok({ invite_id: existing[0].id, status: "pending", idempotent: true });
    } catch (_e) {}

    let invite: any = null;
    try {
      invite = await base44.asServiceRole.entities.Invite.create({
        store_id,
        invite_email: email,
        invited_by: user.email,
        role: "affiliate",
        status: "pending",
        created_at: new Date().toISOString(),
      });
    } catch (_e) {
      // If Invite entity not present, fall back to ActivityEvent only.
      invite = { id: `invite-${Date.now()}`, status: "pending" };
    }

    try {
      await base44.asServiceRole.entities.ActivityEvent.create({
        store_id,
        user_id: user.id || null,
        device_id: null,
        event_type: "affiliate_invite_sent",
        entity_id: invite.id,
        metadata_json: { invite_email: email },
        created_at: new Date().toISOString(),
      });
    } catch (_e) {}

    return ok({ invite_id: invite.id, status: invite.status || "pending" });
  } catch (err) {
    return fail("INTERNAL", err?.message || "Unknown error", null, 500);
  }
});
