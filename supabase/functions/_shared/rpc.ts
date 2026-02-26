import { corsHeaders } from "./cors.ts";

/**
 * Minimal admin RPC caller using direct fetch to PostgREST.
 *
 * This avoids edge-runtime differences in postgrest-js serialization for jsonb/text args.
 * Works with both legacy service_role JWT and new sb_secret_* keys.
 */

function getEnv(name: string): string {
  return String(Deno.env.get(name) || "").trim();
}

function getServiceKey(): string {
  return getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SUPABASE_SECRET_KEY");
}

function getUrl(): string {
  return getEnv("SUPABASE_URL");
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export type RpcAdminError = Error & { status?: number; details?: any; hint?: any };

export async function rpcAdmin<T = any>(fnName: string, args: Record<string, any>): Promise<T> {
  const url = getUrl();
  const key = getServiceKey();
  if (!url) throw new Error("Missing SUPABASE_URL secret");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) secret");

  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      ...corsHeaders,
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(args ?? {}),
  });

  const json = await readJson(res);
  if (!res.ok) {
    const msg = json?.message || json?.error || `RPC failed (${res.status})`;
    const err: RpcAdminError = Object.assign(new Error(msg), {
      status: res.status,
      details: json?.details,
      hint: json?.hint,
    });
    throw err;
  }
  return json as T;
}
