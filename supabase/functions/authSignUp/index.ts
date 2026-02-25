import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonFailFromError, jsonOk } from "../_shared/response.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { normalizeEmail } from "../_shared/normalize.ts";
import { hashPassword } from "../_shared/password.ts";
import { issueSession, listMembershipsAndStores } from "../_shared/auth.ts";
import { applyInvitationEffects, recordInvitationUse, validateInvitationCode } from "../_shared/invites.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const body = await req.json();

    const full_name = String(body?.full_name ?? "").trim();
    const phone_number = String(body?.phone_number ?? "").trim();
    const password = String(body?.password ?? "");
    const confirm_password = String(body?.confirm_password ?? "");
    const device_id = String(body?.device_id ?? "").trim();
    const invitation_code_raw = body?.invitation_code;

    if (!full_name || !phone_number || !device_id) {
      return jsonFail(400, "BAD_REQUEST", "full_name, phone_number, device_id required");
    }
    if (!password || !confirm_password) {
      return jsonFail(400, "BAD_REQUEST", "password and confirm_password required");
    }
    if (password !== confirm_password) {
      return jsonFail(400, "BAD_REQUEST", "Passwords do not match");
    }

    const { email, email_canonical } = normalizeEmail(body?.email);
    if (!email || !email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Invalid email");

    const { data: existing, error: exErr } = await supabase
      .from("user_accounts")
      .select("user_id")
      .eq("email_canonical", email_canonical)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existing) return jsonFail(409, "EMAIL_EXISTS", "Email already registered");

    const password_hash = await hashPassword(password);
    const user_id = crypto.randomUUID();

    const { data: userRow, error: uErr } = await supabase
      .from("user_accounts")
      .insert({
        user_id,
        full_name,
        phone_number,
        email,
        password_hash,
        is_active: true,
      })
      .select("user_id,full_name,phone_number,email,email_canonical")
      .single();

    if (uErr) throw new Error(`Failed to create user: ${uErr.message}`);

    let invitation_applied: any = null;
    if (invitation_code_raw) {
      const inv = await validateInvitationCode(invitation_code_raw);
      await recordInvitationUse({
        invitation_code_id: inv.invitation_code_id,
        used_by_user_id: user_id,
        metadata_json: { device_id },
      });
      invitation_applied = await applyInvitationEffects({
        invitation: inv,
        new_user: { user_id, email, full_name },
      });
    }

    const { tokens } = await issueSession({ user_id, device_id });
    const { memberships, stores } = await listMembershipsAndStores(user_id);
    const next_action = memberships.length === 0 ? "create_first_store" : "select_store";

    return jsonOk({
      user: {
        user_id: userRow.user_id,
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
});
