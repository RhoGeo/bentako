export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-posync-access-token",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json");
  // CORS
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function ok(data: unknown) {
  return json({ ok: true, data });
}

export function fail(code: string, message: string, details?: unknown, status = 400) {
  return json({ ok: false, error: { code, message, details } }, { status });
}

export async function readJson(req: Request) {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }
}
