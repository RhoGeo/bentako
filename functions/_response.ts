export function ok(data: Record<string, unknown> = {}) {
  return Response.json({ ok: true, data });
}

export function fail(
  code: string,
  message: string,
  details?: unknown,
  status = 400,
) {
  return Response.json(
    { ok: false, error: { code, message, details } },
    { status },
  );
}
