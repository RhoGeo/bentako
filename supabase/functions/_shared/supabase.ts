import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Service-role Supabase client for Edge Functions.
 *
 * NOTE: This repo uses custom auth (x-posync-access-token) and does NOT rely on
 * Supabase Auth JWT verification in functions.
 */
function base64UrlToString(input: string): string {
  // JWT uses base64url (RFC 7515). Convert to base64 for atob.
  let s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return atob(s);
}

export function getServiceClient() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").trim();
  const key = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url) throw new Error("Missing SUPABASE_URL secret");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY secret");

  // Validate that the key is a JWT and is service_role. This prevents accidentally using the anon key.
  try {
    const parts = key.split(".");
    if (parts.length < 2) throw new Error("Key is not a JWT (missing '.')");
    const payloadJson = base64UrlToString(parts[1] || "");
    const payload = JSON.parse(payloadJson || "{}");
    if (payload?.role !== "service_role") {
      throw new Error(`Key role is not service_role (got: ${payload?.role || "unknown"})`);
    }
  } catch (e: any) {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY invalid/unexpected: ${e?.message || e}`);
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Back-compat alias (existing functions import `supabaseService`).
export function supabaseService() {
  return getServiceClient();
}
