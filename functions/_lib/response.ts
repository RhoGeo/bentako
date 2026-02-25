export type ApiError = { code: string; message: string; details?: unknown };
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export function jsonOk<T>(data: T, init: ResponseInit = {}): Response {
  return Response.json({ ok: true, data }, init);
}

export function jsonFail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  init: ResponseInit = {}
): Response {
  return Response.json(
    { ok: false, error: { code, message, details } },
    { status, ...init }
  );
}

export function asErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Error";
  try {
    return JSON.stringify(err);
  } catch (_e) {
    return "Unknown error";
  }
}

/**
 * Convert a thrown error into a consistent API error response.
 * IMPORTANT: Many auth/permission errors are thrown as Error objects with a `code` property.
 * We must not surface these as HTTP 500, otherwise the client will endlessly retry.
 */
export function jsonFailFromError(err: any): Response {
  const code = (err && (err.code || err.errorCode)) || "INTERNAL";
  const message = asErrorMessage(err);

  if (code === "UNAUTHORIZED") return jsonFail(401, code, message);
  if (code === "FORBIDDEN") return jsonFail(403, code, message);
  if (code === "PIN_REQUIRED") return jsonFail(403, code, message);
  if (code === "BAD_REQUEST") return jsonFail(400, code, message);

  // Some SDK errors expose an HTTP status
  const status = Number(err?.status || err?.response?.status || 0);
  if (status >= 400 && status < 500) {
    return jsonFail(status, code || "REQUEST_FAILED", message);
  }

  return jsonFail(500, "INTERNAL", message);
}
