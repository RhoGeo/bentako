import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Service Supabase client for Edge Functions.
 *
 * Accepts either:
 * - Legacy JWT-based `service_role` key (eyJ... with dots), OR
 * - New Secret API key (`sb_secret_...`) which replaces service_role.
 *
 * Docs:
 * - API keys overview: https://supabase.com/docs/guides/api/api-keys
 */
function base64UrlToString(input: string): string {
  // JWT uses base64url (RFC 7515). Convert to base64 for atob.
  let s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return atob(s);
}

function validateServiceKey(key: string) {
  const k = String(key || "").trim();

  // New key format: sb_secret_... (recommended replacement for service_role)
  if (k.startsWith("sb_secret_")) return;

  // If someone accidentally pasted a publishable key here, fail loudly.
  if (k.startsWith("sb_publishable_")) {
    throw new Error("Looks like a publishable key (sb_publishable_...). Use a secret key (sb_secret_...) or legacy service_role key.");
  }

  // Legacy JWT service_role key: validate role claim to prevent accidentally using anon.
  const parts = k.split(".");
  if (parts.length < 2) throw new Error("Key is not a JWT and not sb_secret_.");
  const payloadJson = base64UrlToString(parts[1] || "");
  const payload = JSON.parse(payloadJson || "{}");
  if (payload?.role !== "service_role") {
    throw new Error(`Key role is not service_role (got: ${payload?.role || "unknown"})`);
  }
}

export function getServiceClient() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").trim();
  const key = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SECRET_KEY") ||
      ""
  ).trim();

  if (!url) throw new Error("Missing SUPABASE_URL secret");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) secret");

  try {
    validateServiceKey(key);
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
