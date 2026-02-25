import { corsHeaders } from "./cors.ts";

export type ApiError = { code: string; message: string; details?: unknown };

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export function jsonFail(status: number, code: string, message: string, details?: unknown): Response {
  const error: ApiError = { code, message };
  if (details !== undefined) error.details = details;
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export function jsonFailFromError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  return jsonFail(500, "INTERNAL", message);
}
