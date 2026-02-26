/**
 * auth — Custom DB-backed auth (NO Base44 auth).
 *
 * Auth flow:
 * - SignIn/SignUp issue opaque access_token + refresh_token.
 * - Server stores token hashes in AuthSession.
 * - Protected endpoints require Authorization: Bearer <access_token>.
 */

import { jsonFail } from "./response.ts";
import { assertRequiredEntitiesExist } from "./schemaVerify.ts";
import { hashToken, generateTokenPair } from "./sessionTokens.ts";

export type AuthedUser = {
  id: string; // compatibility with existing code (same as user_id)
  user_id: string;
  email: string;
  full_name: string;
  phone_number?: string;
  role?: string;
};

export type AuthedSession = {
  session_id: string;
  access_expires_at: string;
  refresh_expires_at: string;
};

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}


function getAccessTokenFromRequest(req: Request): string | null {
  // Frontend uses anon key for function gateway auth and passes the real session token separately.
  const custom = req.headers.get("x-posync-access-token") || req.headers.get("X-POSYNC-ACCESS-TOKEN");
  if (custom && String(custom).trim()) return String(custom).trim();
  return getBearerToken(req);
}



export async function requireAuth(base44: any, req: Request): Promise<{ user: AuthedUser; session: AuthedSession }>{
  assertRequiredEntitiesExist(base44, [
    "UserAccount",
    "AuthSession",
  ]);

  const token = getAccessTokenFromRequest(req);
  if (!token) {
    throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
  }
  const tokenHash = await hashToken(token);
  const sessions = await base44.asServiceRole.entities.AuthSession.filter({ access_token_hash: tokenHash });
  const s = sessions?.[0];
  if (!s) throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
  if (s.revoked_at) throw Object.assign(new Error("Session revoked"), { code: "UNAUTHORIZED" });
  const exp = Date.parse(String(s.access_expires_at || s.expires_at || ""));
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    throw Object.assign(new Error("Session expired"), { code: "UNAUTHORIZED" });
  }

  const users = await base44.asServiceRole.entities.UserAccount.filter({ user_id: s.user_id });
  const u = users?.[0];
  if (!u || u.is_active === false) {
    throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
  }
  const user: AuthedUser = {
    id: u.user_id,
    user_id: u.user_id,
    email: u.email,
    full_name: u.full_name,
    phone_number: u.phone_number,
    role: "user",
  };
  const session: AuthedSession = {
    session_id: s.session_id || s.id,
    access_expires_at: String(s.access_expires_at || s.expires_at),
    refresh_expires_at: String(s.expires_at || s.refresh_expires_at || ""),
  };
  return { user, session };
}

export async function issueSession(base44: any, args: {
  user_id: string;
  device_id: string;
}): Promise<{ tokens: ReturnType<typeof generateTokenPair>; session_row: any }> {
  assertRequiredEntitiesExist(base44, ["AuthSession"]);

  const tokens = generateTokenPair();
  const access_token_hash = await hashToken(tokens.access_token);
  const refresh_token_hash = await hashToken(tokens.refresh_token);

  const session_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = await base44.asServiceRole.entities.AuthSession.create({
    session_id,
    user_id: args.user_id,
    device_id: args.device_id,
    access_token_hash,
    refresh_token_hash,
    access_expires_at: tokens.access_expires_at,
    expires_at: tokens.refresh_expires_at,
    revoked_at: null,
    created_at: now,
    updated_at: now,
  });
  return { tokens, session_row: row };
}

export async function revokeSessionByAccessToken(base44: any, access_token: string): Promise<void> {
  const access_token_hash = await hashToken(access_token);
  const sessions = await base44.asServiceRole.entities.AuthSession.filter({ access_token_hash });
  const s = sessions?.[0];
  if (!s) return;
  await base44.asServiceRole.entities.AuthSession.update(s.id, {
    revoked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function listMembershipsAndStores(base44: any, user_id: string) {
  const memberships = await base44.asServiceRole.entities.StoreMembership.filter({ user_id, is_active: true });
  const stores: any[] = [];
  for (const m of memberships || []) {
    try {
      const s = await base44.asServiceRole.entities.Store.filter({ id: m.store_id });
      if (s?.[0]) stores.push(s[0]);
    } catch (_e) {}
  }
  return { memberships: memberships || [], stores };
}

export function toAuthErrorResponse(err: any): Response {
  const code = (err && (err.code || err.errorCode)) || "INTERNAL";
  const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "BAD_REQUEST" ? 400 : 500;
  return jsonFail(status, String(code), err?.message || "Error", err?.details);
}
