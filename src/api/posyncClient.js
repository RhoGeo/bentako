import { appParams } from "@/lib/app-params";
import { getAccessToken } from "@/lib/auth/session";

function trimSlash(s) {
  return typeof s === "string" ? s.replace(/\/+$|\/+$/g, "") : s;
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
        // Use anon key for function gateway auth; our custom session token is passed separately.
        authorization: `Bearer ${anon}`,
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
    const msg = json?.error?.message || `Request failed with status code ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}
