// Deno/WebCrypto-based hashing & tokens (NO Worker usage)

function b64url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

// PBKDF2 password hashing suitable for Edge runtime
// Stored format: pbkdf2$sha256$<iters>$<salt_b64url>$<hash_b64url>
const DEFAULT_ITERS = 310_000;
const KEYLEN = 32;

export async function hashPassword(plain: string, iters = DEFAULT_ITERS): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
    key,
    KEYLEN * 8,
  );

  const hash = new Uint8Array(bits);
  return `pbkdf2$sha256$${iters}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5) return false;
  const [algo, hashName, itersStr, saltB64, hashB64] = parts;
  if (algo !== "pbkdf2" || hashName !== "sha256") return false;
  const iters = Number(itersStr);
  if (!Number.isFinite(iters) || iters < 10_000) return false;

  const salt = fromB64url(saltB64);
  const expected = fromB64url(hashB64);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
    key,
    expected.length * 8,
  );
  const actual = new Uint8Array(bits);

  // constant-time compare
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export const ACCESS_TTL_MS = 1000 * 60 * 60 * 24; // 24h
export const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30d

export function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
