import { supabaseService } from "./supabase.ts";
import { randomToken, sha256Hex } from "./crypto.ts";

export const ACCESS_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type SessionTokens = {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
};

export type AuthedUser = {
  user_id: string;
  full_name: string;
  phone_number: string;
  email: string;
  email_canonical: string;
  is_active: boolean;
};

export async function issueSession(args: { user_id: string; device_id: string }): Promise<{ tokens: SessionTokens; session_id: string }> {
  const supabase = supabaseService();
  const now = Date.now();
  const access_token = randomToken(32);
  const refresh_token = randomToken(48);
  const access_expires_at = new Date(now + ACCESS_TTL_MS).toISOString();
  const refresh_expires_at = new Date(now + REFRESH_TTL_MS).toISOString();

  const access_token_hash = await sha256Hex(access_token);
  const refresh_token_hash = await sha256Hex(refresh_token);

  const { data, error } = await supabase
    .from("auth_sessions")
    .insert({
      user_id: args.user_id,
      device_id: args.device_id,
      access_token_hash,
      refresh_token_hash,
      access_expires_at,
      refresh_expires_at,
    })
    .select("session_id")
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);

  return {
    tokens: { access_token, refresh_token, access_expires_at, refresh_expires_at },
    session_id: data.session_id,
  };
}

function getPosyncAccessToken(req: Request): string | null {
  // We pass our custom token via x-posync-access-token so we can keep Supabase verify_jwt disabled.
  const h = req.headers;
  const v = h.get("x-posync-access-token");
  if (v) return v.trim();
  const auth = h.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function requireAuth(req: Request): Promise<{ user: AuthedUser; session_id: string }> {
  const token = getPosyncAccessToken(req);
  if (!token) throw new Error("Missing access token");
  const token_hash = await sha256Hex(token);

  const supabase = supabaseService();
  const { data: sess, error: sessErr } = await supabase
    .from("auth_sessions")
    .select("session_id,user_id,access_expires_at,revoked_at")
    .eq("access_token_hash", token_hash)
    .maybeSingle();

  if (sessErr) throw new Error(`Auth lookup failed: ${sessErr.message}`);
  if (!sess || sess.revoked_at) throw new Error("Unauthorized");
  if (new Date(sess.access_expires_at).getTime() < Date.now()) throw new Error("Session expired");

  const { data: user, error: userErr } = await supabase
    .from("user_accounts")
    .select("user_id,full_name,phone_number,email,email_canonical,is_active")
    .eq("user_id", sess.user_id)
    .single();

  if (userErr) throw new Error(`User lookup failed: ${userErr.message}`);
  if (!user.is_active) throw new Error("User inactive");

  return { user, session_id: sess.session_id };
}

export async function revokeSessionByToken(req: Request): Promise<void> {
  const token = getPosyncAccessToken(req);
  if (!token) return;
  const token_hash = await sha256Hex(token);

  const supabase = supabaseService();
  const { error } = await supabase
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("access_token_hash", token_hash);

  if (error) throw new Error(`Failed to revoke session: ${error.message}`);
}

export async function listMembershipsAndStores(user_id: string) {
  const supabase = supabaseService();
  const { data: memberships, error: mErr } = await supabase
    .from("store_memberships")
    .select("store_membership_id,store_id,role,permission_set_id,overrides_json,is_active,created_at")
    .eq("user_id", user_id)
    .eq("is_active", true);

  if (mErr) throw new Error(`Failed to list memberships: ${mErr.message}`);
  const storeIds = Array.from(new Set((memberships ?? []).map((m) => m.store_id)));
  let stores: any[] = [];
  if (storeIds.length) {
    const { data: s, error: sErr } = await supabase
      .from("stores")
      .select("store_id,store_code,store_name,store_settings_json,low_stock_threshold_default,allow_negative_stock")
      .in("store_id", storeIds)
      .is("deleted_at", null);
    if (sErr) throw new Error(`Failed to list stores: ${sErr.message}`);
    stores = s ?? [];
  }

  return { memberships: memberships ?? [], stores };
}
