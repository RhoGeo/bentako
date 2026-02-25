import { ok, fail, json, readJson } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { hashPassword, randomToken, sha256Hex, isoFromNow, ACCESS_TTL_MS, REFRESH_TTL_MS } from "../_shared/crypto.ts";
import { listMembershipsAndStores } from "../_shared/auth.ts";

function normalizeEmail(e: unknown) {
  const raw = (e ?? "").toString().trim();
  return raw;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, { status: 200 });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use POST", undefined, 405);

  try {
    const body = await readJson(req);
    const full_name = (body.full_name ?? "").toString().trim();
    const phone_number = (body.phone_number ?? "").toString().trim();
    const email = normalizeEmail(body.email);
    const password = (body.password ?? "").toString();
    const confirm_password = (body.confirm_password ?? "").toString();
    const invitation_code = (body.invitation_code ?? "").toString().trim();
    const device_id = (body.device_id ?? "").toString().trim();

    if (!full_name || !phone_number || !email || !password || !confirm_password || !device_id) {
      return fail("VALIDATION", "Missing required fields");
    }
    if (password !== confirm_password) {
      return fail("PASSWORD_MISMATCH", "Password and confirm password do not match", undefined, 400);
    }

    const supabase = getServiceClient();

    // Create user
    const password_hash = await hashPassword(password);

    const { data: createdUsers, error: uerr } = await supabase
      .from("user_accounts")
      .insert({ full_name, phone_number, email, password_hash, is_active: true })
      .select("user_id,full_name,phone_number,email")
      .limit(1);

    if (uerr) {
      // unique email violation
      const msg = (uerr as any)?.message || "Email already exists";
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return fail("EMAIL_EXISTS", "Email already exists", undefined, 409);
      }
      return fail("DB_ERROR", "Failed to create user", uerr, 500);
    }

    const user = createdUsers?.[0];
    if (!user) return fail("DB_ERROR", "Failed to create user", undefined, 500);

    // Invitation code (optional)
    let invitation_applied: any = null;
    if (invitation_code) {
      const { data: codes, error: cerr } = await supabase
        .from("invitation_codes")
        .select("invitation_code_id,code,type,store_id,role,affiliate_profile_id,max_uses,used_count,expires_at")
        .eq("code", invitation_code)
        .limit(1);
      if (cerr) return fail("DB_ERROR", "Failed to validate invitation code", cerr, 500);
      const code = codes?.[0];
      if (!code) return fail("INVITE_INVALID", "Invitation code not found", undefined, 400);
      if (code.expires_at && new Date(code.expires_at).getTime() <= Date.now()) {
        return fail("INVITE_EXPIRED", "Invitation code expired", undefined, 400);
      }
      if (code.used_count >= code.max_uses) {
        return fail("INVITE_MAXED", "Invitation code already used", undefined, 400);
      }

      // record use + increment
      await supabase.from("invitation_code_uses").insert({
        invitation_code_id: code.invitation_code_id,
        used_by_user_id: user.user_id,
        metadata_json: { channel: "signup" },
      });
      await supabase
        .from("invitation_codes")
        .update({ used_count: (code.used_count ?? 0) + 1 })
        .eq("invitation_code_id", code.invitation_code_id);

      if (code.type === "staff_invite") {
        if (!code.store_id) return fail("INVITE_INVALID", "Staff invite missing store", undefined, 400);
        const role = code.role || "cashier";
        await supabase.from("store_memberships").insert({
          store_id: code.store_id,
          user_id: user.user_id,
          role,
          created_by: user.user_id,
          is_active: true,
        });
        invitation_applied = { type: "staff_invite" };
      }
      if (code.type === "affiliate_referral") {
        if (!code.affiliate_profile_id) return fail("INVITE_INVALID", "Referral code missing affiliate", undefined, 400);
        await supabase.from("referral_attributions").insert({
          affiliate_profile_id: code.affiliate_profile_id,
          referred_user_id: user.user_id,
          invitation_code_id: code.invitation_code_id,
        });
        invitation_applied = { type: "affiliate_referral" };
      }
    }

    // Issue tokens (store only hashes)
    const access_token = randomToken(32);
    const refresh_token = randomToken(48);
    const access_expires_at = isoFromNow(ACCESS_TTL_MS);
    const refresh_expires_at = isoFromNow(REFRESH_TTL_MS);

    const access_token_hash = await sha256Hex(access_token);
    const refresh_token_hash = await sha256Hex(refresh_token);

    const { data: sessions, error: serr } = await supabase
      .from("auth_sessions")
      .insert({
        user_id: user.user_id,
        device_id,
        access_token_hash,
        refresh_token_hash,
        access_expires_at,
        refresh_expires_at,
      })
      .select("session_id")
      .limit(1);

    if (serr) return fail("DB_ERROR", "Failed to create session", serr, 500);

    const { memberships, stores } = await listMembershipsAndStores(user.user_id);
    const next_action = memberships.length ? "select_store" : "create_first_store";

    return ok({
      user,
      session: { access_token, refresh_token, access_expires_at, refresh_expires_at },
      memberships,
      stores,
      next_action,
      invitation_applied,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    return fail("SERVER_ERROR", msg, e, 500);
  }
});
