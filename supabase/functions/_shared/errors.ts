import { jsonFail } from "./response.ts";

export function mapErrorToResponse(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);

  // Auth
  if (msg === "AUTH_REQUIRED" || msg === "AUTH_EXPIRED") {
    return jsonFail(401, msg, msg);
  }

  // Permissions / access
  if (/^Forbidden/i.test(msg) || msg === "FORBIDDEN") {
    return jsonFail(403, "FORBIDDEN", msg);
  }

  // PIN
  if (msg === "PIN_REQUIRED") {
    return jsonFail(403, "PIN_REQUIRED", msg);
  }

  // Client input
  if (
    msg === "BAD_REQUEST" ||
    /required/i.test(msg) ||
    /must be/i.test(msg) ||
    /Unsupported/i.test(msg) ||
    /NOT_ALLOWED/i.test(msg) ||
    /PAYMENT_EXCEEDS_BALANCE/i.test(msg)
  ) {
    return jsonFail(400, "BAD_REQUEST", msg);
  }

  // Not found
  if (/not found/i.test(msg)) {
    return jsonFail(404, "NOT_FOUND", msg);
  }


  // Uniqueness / conflicts (e.g., barcode uniqueness per store)
  if (/duplicate key value violates unique constraint/i.test(msg) || /unique constraint/i.test(msg)) {
    return jsonFail(409, "CONFLICT", msg);
  }

  // Default
  return jsonFail(500, "INTERNAL", msg);
}
