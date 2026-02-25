import { getServiceClient } from "./supabase.ts";
import { sha256Hex } from "./crypto.ts";

export type Authed = {
  user: { user_id: string; full_name: string; email: string; phone_number: string };
  session: { session_id: string; access_expires_at: string; refresh_expires_at: string; device_id: string };
};

export async function requireAuth(req: Request): Promise<Authed> {
  const token = req.headers.get("x-posync-access-token") || "";
  if (!token) throw new Error("AUTH_REQUIRED");

  const supabase = getServiceClient();
  const tokenHash = await sha256Hex(token);

  const { data: sessions, error } = await supabase
    .from("auth_sessions")
    .select("session_id,user_id,device_id,access_expires_at,refresh_expires_at,revoked_at")
    .eq("access_token_hash", tokenHash)
    .limit(1);

  if (error) throw error;
  const s = sessions?.[0];
  if (!s || s.revoked_at) throw new Error("AUTH_REQUIRED");
  if (new Date(s.access_expires_at).getTime() <= Date.now()) throw new Error("AUTH_EXPIRED");

  const { data: users, error: uerr } = await supabase
    .from("user_accounts")
    .select("user_id,full_name,email,phone_number,is_active")
    .eq("user_id", s.user_id)
    .limit(1);

  if (uerr) throw uerr;
  const u = users?.[0];
  if (!u || u.is_active === false) throw new Error("AUTH_REQUIRED");

  return {
    user: { user_id: u.user_id, full_name: u.full_name, email: u.email, phone_number: u.phone_number },
    session: {
      session_id: s.session_id,
      device_id: s.device_id,
      access_expires_at: s.access_expires_at,
      refresh_expires_at: s.refresh_expires_at,
    },
  };
}

export async function listMembershipsAndStores(user_id: string) {
  const supabase = getServiceClient();
  const { data: memberships, error: merr } = await supabase
    .from("store_memberships")
    .select("store_membership_id,store_id,role,permission_set_id,overrides_json,is_active")
    .eq("user_id", user_id)
    .eq("is_active", true);
  if (merr) throw merr;

  const storeIds = (memberships || []).map((m) => m.store_id);
  let stores = [];
  if (storeIds.length) {
    const { data: sdata, error: serr } = await supabase
      .from("stores")
      .select("store_id,store_name,store_code,store_settings_json,low_stock_threshold_default,allow_negative_stock,archived_at")
      .in("store_id", storeIds)
      .is("deleted_at", null);
    if (serr) throw serr;
    // Default: hide archived stores from the main app store list.
    stores = (sdata || []).filter((s) => !s.archived_at);
  }

  return { memberships: memberships || [], stores };
}
