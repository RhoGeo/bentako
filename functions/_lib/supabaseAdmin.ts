/**
 * Supabase admin REST helpers (service role).
 *
 * Requires env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */
type RpcError = { code?: string; message?: string; details?: unknown; hint?: string };

function env(name: string): string {
  const v = Deno.env.get(name);
  return v ? String(v) : "";
}

const SUPABASE_URL = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");

function assertConfigured() {
  if (!SUPABASE_URL) throw Object.assign(new Error("Missing SUPABASE_URL env var"), { code: "INTERNAL" });
  if (!SERVICE_KEY) throw Object.assign(new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var"), { code: "INTERNAL" });
}

function headers() {
  assertConfigured();
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    "content-type": "application/json",
    accept: "application/json",
  } as Record<string, string>;
}

async function readJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

function toRpcThrown(err: RpcError, status: number) {
  const e = Object.assign(new Error(err?.message || `RPC failed (${status})`), {
    code: err?.code || "RPC_ERROR",
    status,
    details: err?.details || err,
  });
  return e;
}

export async function rpc<T = any>(fnName: string, args: Record<string, unknown>): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args ?? {}),
  });
  const json = await readJson(res);
  if (!res.ok) throw toRpcThrown(json || {}, res.status);
  return json as T;
}

export async function restGet<T = any>(pathWithLeadingSlash: string): Promise<T> {
  const url = `${SUPABASE_URL}${pathWithLeadingSlash}`;
  const res = await fetch(url, { headers: headers() });
  const json = await readJson(res);
  if (!res.ok) {
    throw Object.assign(new Error(json?.message || `REST GET failed (${res.status})`), {
      code: json?.code || "REST_ERROR",
      status: res.status,
      details: json,
    });
  }
  return json as T;
}
