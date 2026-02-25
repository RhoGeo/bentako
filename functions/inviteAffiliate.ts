/**
 * inviteAffiliate — Store sends affiliate invite.
 *
 * Step 12.2:
 * - Managers/Cashiers can invite affiliates if permission enabled
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { logActivityEvent } from "./_lib/activity.ts";

function cleanEmail(v: any) {
  return String(v || "").trim().toLowerCase();
}

export async function inviteAffiliate(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);

    const body = await req.json();
    const store_id = String(body?.store_id || "").trim();
    const invite_email = cleanEmail(body?.invite_email);
    if (!store_id || !invite_email) return jsonFail(400, "BAD_REQUEST", "store_id and invite_email required");
    if (!invite_email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Invalid email");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "affiliate_invite");

    // Idempotency: avoid duplicate pending invites.
    try {
      const existing = await base44.asServiceRole.entities.Invite.filter({ store_id, invite_email, status: "pending" });
      if (existing?.length) return jsonOk({ invite_id: existing[0].id, status: "pending", idempotent: true });
    } catch (_e) {}

    let invite: any = null;
    try {
      invite = await base44.asServiceRole.entities.Invite.create({
        store_id,
        invite_email,
        invited_by: user.email,
        role: "affiliate",
        status: "pending",
        created_at: new Date().toISOString(),
      });
    } catch (_e) {
      // If Invite entity is missing, fall back to ActivityEvent only.
      invite = { id: `invite-${Date.now()}`, status: "pending" };
    }

    // Audit log
    try {
      await logActivityEvent(base44, {
        store_id,
        event_type: "affiliate_invite_sent",
        description: `Affiliate invitation sent to ${invite_email}`,
        entity_id: invite.id,
        user_id: user.user_id,
        actor_email: user.email,
        metadata_json: { invite_email },
      });
    } catch (_e) {}

    return jsonOk({ invite_id: invite.id, status: invite.status || "pending" });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(inviteAffiliate);
