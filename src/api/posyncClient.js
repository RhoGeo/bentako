import { appParams } from "@/lib/app-params";
import { getAccessToken } from "@/lib/auth/session";

function trimSlash(s) {
  return typeof s === "string" ? s.replace(/\/+$|\/+$/g, "") : s;
}

function isJwtLike(key) {
  const k = typeof key === "string" ? key.trim() : "";
  // legacy anon/service_role keys are JWTs with 3 segments
  return k.split(".").length === 3;
}

function assertSupabaseConfigured() {
  const url = trimSlash(appParams?.supabaseUrl);
  const anon = appParams?.supabaseAnonKey;
  if (!url) throw new Error("Missing VITE_SUPABASE_URL");
  if (!anon) throw new Error("Missing VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY or VITE_SUPABASE_ANON_KEY");
  return { url, anon };
}

export async function invokeFunction(functionName, payload = {}) {
  const { url, anon } = assertSupabaseConfigured();
  const access = getAccessToken();

  const endpoint = `${url}/functions/v1/${functionName}`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anon,
        // IMPORTANT: For new publishable keys (sb_publishable_*), do NOT send it as "Bearer" in Authorization.
        // Supabase no longer allows non-JWT keys to be used like JWTs in the Authorization header. 
        ...(isJwtLike(anon) ? { authorization: `Bearer ${anon}` } : {}),
        ...(access ? { "x-posync-access-token": access } : {}),
      },
      body: JSON.stringify(payload ?? {}),
    });
  } catch (e) {
    const isHttpsPage = typeof window !== "undefined" && window.location?.protocol === "https:";
    const isHttpSupabase = String(url || "").startsWith("http://");
    const hint = isHttpsPage && isHttpSupabase
      ? "(Mixed content: your app is HTTPS but VITE_SUPABASE_URL is HTTP)"
      : "(Network/CORS error)";
    const err = new Error(
      `Failed to reach Supabase Edge Function '${functionName}'. ${hint}\n` +
        `URL: ${endpoint}\n` +
        `Fix: confirm VITE_SUPABASE_URL and your public key (VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY or VITE_SUPABASE_ANON_KEY) match your Supabase project, and that the function '${functionName}' is deployed.`
    );
    err.cause = e;
    throw err;
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Request failed with status code ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}
