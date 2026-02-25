/**
 * invitationCodes — validation + application logic for sign-up.
 *
 * Required by spec:
 * - staff_invite creates StoreMembership for that store at signup.
 * - affiliate_referral creates ReferralAttribution at signup.
 */

import { normalizeInvitationCode } from "./authNormalization.ts";

export type InvitationApplied = { type: "affiliate_referral" | "staff_invite" };

function isExpired(expires_at?: string | null): boolean {
  if (!expires_at) return false;
  const t = Date.parse(expires_at);
  return Number.isFinite(t) ? t <= Date.now() : false;
}

export async function validateInvitationCode(base44: any, codeInput: unknown) {
  const code = normalizeInvitationCode(codeInput);
  if (!code) {
    throw Object.assign(new Error("Invalid invitation code"), { code: "BAD_REQUEST" });
  }
  const rows = await base44.asServiceRole.entities.InvitationCode.filter({ code });
  const inv = rows?.[0];
  if (!inv) {
    throw Object.assign(new Error("Invitation code not found"), { code: "INVITE_INVALID" });
  }
  if (inv.is_active === false) {
    throw Object.assign(new Error("Invitation code inactive"), { code: "INVITE_INVALID" });
  }
  if (isExpired(inv.expires_at)) {
    throw Object.assign(new Error("Invitation code expired"), { code: "INVITE_EXPIRED" });
  }
  const max = inv.max_uses == null ? null : Number(inv.max_uses);
  const used = inv.used_count == null ? 0 : Number(inv.used_count);
  if (max != null && used >= max) {
    throw Object.assign(new Error("Invitation code has reached max uses"), { code: "INVITE_MAXED" });
  }
  return inv;
}

async function incrementInvitationUse(base44: any, invitation_code_id: string) {
  const rows = await base44.asServiceRole.entities.InvitationCode.filter({ invitation_code_id });
  const inv = rows?.[0];
  if (!inv) return;
  const used = inv.used_count == null ? 0 : Number(inv.used_count);
  await base44.asServiceRole.entities.InvitationCode.update(inv.id, {
    used_count: used + 1,
    updated_at: new Date().toISOString(),
  });
}

export async function recordInvitationUse(base44: any, args: {
  invitation_code_id: string;
  used_by_user_id: string;
  metadata_json?: any;
}) {
  // Prevent accidental double-recording for the same user.
  const existing = await base44.asServiceRole.entities.InvitationCodeUse.filter({
    invitation_code_id: args.invitation_code_id,
    used_by_user_id: args.used_by_user_id,
  });
  if (existing?.length) return existing[0];

  const row = await base44.asServiceRole.entities.InvitationCodeUse.create({
    invitation_code_id: args.invitation_code_id,
    used_by_user_id: args.used_by_user_id,
    used_at: new Date().toISOString(),
    metadata_json: args.metadata_json || null,
  });
  await incrementInvitationUse(base44, args.invitation_code_id);
  return row;
}

export async function applyInvitationEffects(base44: any, args: {
  invitation: any;
  new_user: { user_id: string; email: string; full_name: string };
}) : Promise<InvitationApplied> {
  const inv = args.invitation;
  const type = String(inv.type || "");

  if (type === "staff_invite") {
    if (!inv.store_id) {
      throw Object.assign(new Error("staff_invite requires store_id"), { code: "INVITE_INVALID" });
    }
    const role = String(inv.role || "cashier").toLowerCase();
    const mapped = role === "owner" ? "owner" : role === "manager" ? "manager" : "cashier";

    // Create StoreMembership (primary) + legacy StaffMember (best-effort).
    await base44.asServiceRole.entities.StoreMembership.create({
      store_id: inv.store_id,
      user_id: args.new_user.user_id,
      user_email: args.new_user.email,
      user_name: args.new_user.full_name,
      role: mapped,
      overrides_json: inv.permission_set_id ? { permission_set_id: inv.permission_set_id } : {},
      is_active: true,
      created_by: args.new_user.user_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    try {
      await base44.asServiceRole.entities.StaffMember.create({
        store_id: inv.store_id,
        user_email: args.new_user.email,
        user_name: args.new_user.full_name,
        role: mapped,
        overrides_json: {},
        is_active: true,
        created_at: new Date().toISOString(),
      });
    } catch (_e) {}

    return { type: "staff_invite" };
  }

  if (type === "affiliate_referral") {
    if (!inv.affiliate_profile_id) {
      throw Object.assign(new Error("affiliate_referral requires affiliate_profile_id"), { code: "INVITE_INVALID" });
    }
    await base44.asServiceRole.entities.ReferralAttribution.create({
      affiliate_profile_id: inv.affiliate_profile_id,
      referred_user_id: args.new_user.user_id,
      invitation_code_id: inv.invitation_code_id,
      created_at: new Date().toISOString(),
    });
    return { type: "affiliate_referral" };
  }

  throw Object.assign(new Error("Unknown invitation code type"), { code: "INVITE_INVALID" });
}
