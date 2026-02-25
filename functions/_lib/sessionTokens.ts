/**
 * sessionTokens — opaque token issuance + hashing.
 *
 * We use random opaque tokens (not JWT) and store only token hashes server-side.
 */

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
};

export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24h
export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30d

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = btoa(s);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return base64Url(new Uint8Array(digest));
}

export function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function generateTokenPair(now = Date.now()): TokenPair {
  const access_token = randomToken(32);
  const refresh_token = randomToken(48);
  return {
    access_token,
    refresh_token,
    access_expires_at: new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
  };
}
