import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Service-role Supabase client for Edge Functions.
 *
 * NOTE: This repo uses custom auth (x-posync-access-token) and does NOT rely on
 * Supabase Auth JWT verification in functions.
 */
export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing SUPABASE_URL secret");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY secret");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Back-compat alias (existing functions import `supabaseService`).
export function supabaseService() {
  return getServiceClient();
}
