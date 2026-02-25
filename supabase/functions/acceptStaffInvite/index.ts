import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();
    const invite_token = str(body?.invite_token);
    if (!invite_token) return jsonFail(400, "BAD_REQUEST", "invite_token required");

    const { data: invite, error: ierr } = await supabase
      .from("invitation_codes")
      .select("invitation_code_id,store_id,role,invite_email,used_count,max_uses,expires_at,revoked_at,created_by")
      .eq("code", invite_token)
      .eq("type", "staff_invite")
      .maybeSingle();
    if (ierr) throw new Error(ierr.message);
    if (!invite) return jsonFail(404, "INVITE_NOT_FOUND", "Invite not found");

    if (invite.revoked_at) return jsonFail(409, "INVITE_REVOKED", "Invite revoked");
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return jsonFail(409, "INVITE_EXPIRED", "Invite expired");
    if ((invite.used_count || 0) >= (invite.max_uses || 1)) return jsonFail(409, "INVITE_USED", "Invite already used");

    const myEmail = String(user.email || "").toLowerCase();
    const invitedEmail = String(invite.invite_email || "").toLowerCase();
    if (invitedEmail && myEmail !== invitedEmail) {
      return jsonFail(403, "FORBIDDEN", "You must be logged in as the invited email");
    }

    const store_id = invite.store_id;
    if (!store_id) return jsonFail(500, "INVALID_INVITE", "Invite missing store_id");

    // Upsert membership without mutating created_by when already present.
    const { data: existing, error: exErr } = await supabase
      .from("store_memberships")
      .select("store_membership_id")
      .eq("store_id", store_id)
      .eq("user_id", user.user_id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);

    if (existing?.store_membership_id) {
      const { error: updErr } = await supabase
        .from("store_memberships")
        .update({ role: invite.role, is_active: true })
        .eq("store_membership_id", existing.store_membership_id);
      if (updErr) throw new Error(updErr.message);
    } else {
      const { error: insErr } = await supabase.from("store_memberships").insert({
        store_id,
        user_id: user.user_id,
        role: invite.role,
        is_active: true,
        created_by: invite.created_by || user.user_id,
      });
      if (insErr) throw new Error(insErr.message);
    }

    // Mark invite used and create a usage record.
    const { error: useErr } = await supabase.from("invitation_code_uses").insert({
      invitation_code_id: invite.invitation_code_id,
      used_by_user_id: user.user_id,
      metadata_json: { kind: "staff_invite" },
    });
    if (useErr) throw new Error(useErr.message);

    const { error: incErr } = await supabase
      .from("invitation_codes")
      .update({ used_count: (invite.used_count || 0) + 1 })
      .eq("invitation_code_id", invite.invitation_code_id);
    if (incErr) throw new Error(incErr.message);

    return jsonOk({ store_id });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
