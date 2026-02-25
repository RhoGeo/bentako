/**
 * POSync custom auth session persistence (Step 4.3)
 * - Persist tokens in localStorage so session survives reload.
 */

const SESSION_KEY = "posync_session_v1";

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token) return null;
    return parsed;
  } catch (_e) {
    return null;
  }
}

export function setSession(session) {
  if (!session?.access_token) throw new Error("access_token required");
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getAccessToken() {
  return getSession()?.access_token || null;
}

export function isSessionExpired(session, now = Date.now()) {
  // Back-compat: server returns { expires_at }, client prefers { access_expires_at }
  const exp = session?.access_expires_at || session?.expires_at;
  if (!exp) return false;
  const ts = Date.parse(exp);
  if (!Number.isFinite(ts)) return false;
  return ts <= now;
}
