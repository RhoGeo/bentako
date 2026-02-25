import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { normalizeEmail } from "./_lib/authNormalization.ts";
import { hashPassword } from "./_lib/passwordHashing.ts";
import { assertRequiredEntitiesExist } from "./_lib/schemaVerify.ts";
import { issueSession, listMembershipsAndStores } from "./_lib/auth.ts";
import { validateInvitationCode, recordInvitationUse, applyInvitationEffects } from "./_lib/invitationCodes.ts";

export async function authSignUp(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    assertRequiredEntitiesExist(base44, [
      "UserAccount",
      "AuthSession",
      "InvitationCode",
      "InvitationCodeUse",
      "StoreMembership",
      "ReferralAttribution",
    ]);

    const body = await req.json();
    const full_name = String(body?.full_name || "").trim();
    const phone_number = String(body?.phone_number || "").trim();
    const password = String(body?.password || "");
    const confirm_password = String(body?.confirm_password || "");
    const invitation_code_raw = body?.invitation_code;
    const device_id = String(body?.device_id || "").trim();

    if (!full_name || !phone_number || !device_id) {
      return jsonFail(400, "BAD_REQUEST", "full_name, phone_number, device_id required");
    }
    if (!password || !confirm_password) {
      return jsonFail(400, "BAD_REQUEST", "password and confirm_password required");
    }
    if (password !== confirm_password) {
      // HARD GATE (server-side)
      return jsonFail(400, "BAD_REQUEST", "Passwords do not match");
    }

    const { email, email_canonical } = normalizeEmail(body?.email);
    if (!email.includes("@")) {
      return jsonFail(400, "BAD_REQUEST", "Invalid email");
    }

    const existing = await base44.asServiceRole.entities.UserAccount.filter({ email_canonical });
    if (existing?.length) {
      return jsonFail(409, "EMAIL_EXISTS", "Email already registered");
    }

    const password_hash = await hashPassword(password);
    const now = new Date().toISOString();
    const user_id = crypto.randomUUID();

    const userRow = await base44.asServiceRole.entities.UserAccount.create({
      user_id,
      full_name,
      phone_number,
      email,
      email_canonical,
      password_hash,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    let invitation_applied: any = null;
    if (invitation_code_raw) {
      const inv = await validateInvitationCode(base44, invitation_code_raw);
      await recordInvitationUse(base44, {
        invitation_code_id: inv.invitation_code_id,
        used_by_user_id: user_id,
        metadata_json: { device_id },
      });
      invitation_applied = await applyInvitationEffects(base44, {
        invitation: inv,
        new_user: { user_id, email, full_name },
      });
    }

    const { tokens } = await issueSession(base44, { user_id, device_id });
    const { memberships, stores } = await listMembershipsAndStores(base44, user_id);
    const next_action = memberships.length === 0 ? "create_first_store" : "select_store";

    return jsonOk({
      user: {
        user_id,
        full_name: userRow.full_name,
        phone_number: userRow.phone_number,
        email: userRow.email,
      },
      session: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.access_expires_at,
      },
      next_action,
      invitation_applied,
      memberships,
      stores,
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(authSignUp);
