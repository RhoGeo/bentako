import { appParams } from "@/lib/app-params";
import { getAccessToken } from "@/lib/auth/session";

function trimSlash(s) {
  return typeof s === "string" ? s.replace(/\/+$|\/+$/g, "") : s;
}

function assertSupabaseConfigured() {
  const url = trimSlash(appParams?.supabaseUrl);
  const anon = appParams?.supabaseAnonKey;
  if (!url) throw new Error("Missing VITE_SUPABASE_URL");
  if (!anon) throw new Error("Missing VITE_SUPABASE_ANON_KEY");
  return { url, anon };
}

export async function invokeFunction(functionName, payload = {}) {
  const { url, anon } = assertSupabaseConfigured();
  const access = getAccessToken();

  const res = await fetch(`${url}/functions/v1/${functionName}`, {
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
