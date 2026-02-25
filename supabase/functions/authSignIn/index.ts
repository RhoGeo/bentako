import { ok, fail, json, readJson } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyPassword, randomToken, sha256Hex, isoFromNow, ACCESS_TTL_MS, REFRESH_TTL_MS } from "../_shared/crypto.ts";
import { listMembershipsAndStores } from "../_shared/auth.ts";

function normalizeEmail(e: unknown) {
  return (e ?? "").toString().trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, { status: 200 });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use POST", undefined, 405);

  try {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = (body.password ?? "").toString();
    const device_id = (body.device_id ?? "").toString().trim();
    if (!email || !password || !device_id) return fail("VALIDATION", "Missing required fields");

    const supabase = getServiceClient();

    const canonical = email.toLowerCase();
    const { data: users, error: uerr } = await supabase
      .from("user_accounts")
      .select("user_id,full_name,phone_number,email,password_hash,is_active")
      .eq("email_canonical", canonical)
      .limit(1);

    if (uerr) return fail("DB_ERROR", "Failed to fetch user", uerr, 500);
    const u = users?.[0];
    if (!u || u.is_active === false) return fail("INVALID_CREDENTIALS", "Invalid email or password", undefined, 401);

    const okPw = await verifyPassword(password, u.password_hash);
    if (!okPw) return fail("INVALID_CREDENTIALS", "Invalid email or password", undefined, 401);

    const access_token = randomToken(32);
    const refresh_token = randomToken(48);
    const access_expires_at = isoFromNow(ACCESS_TTL_MS);
    const refresh_expires_at = isoFromNow(REFRESH_TTL_MS);

    const access_token_hash = await sha256Hex(access_token);
    const refresh_token_hash = await sha256Hex(refresh_token);

    const { error: serr } = await supabase
      .from("auth_sessions")
      .insert({
        user_id: u.user_id,
        device_id,
        access_token_hash,
        refresh_token_hash,
        access_expires_at,
        refresh_expires_at,
      });
    if (serr) return fail("DB_ERROR", "Failed to create session", serr, 500);

    const user = { user_id: u.user_id, full_name: u.full_name, phone_number: u.phone_number, email: u.email };
    const { memberships, stores } = await listMembershipsAndStores(u.user_id);

    let next_action = "go_to_app";
    if (stores.length > 1) next_action = "select_store";
    if (stores.length === 0) next_action = "no_store";

    return ok({
      user,
      session: { access_token, refresh_token, access_expires_at, refresh_expires_at },
      memberships,
      stores,
      next_action,
    });
  } catch (e) {
    return fail("SERVER_ERROR", e?.message || String(e), e, 500);
  }
});
