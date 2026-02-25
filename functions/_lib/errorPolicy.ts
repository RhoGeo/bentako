import { asErrorMessage } from "./response.ts";

export function toApiError(err: unknown): { code: string; message: string; details?: unknown } {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    // passthrough
    // @ts-ignore
    return { code: String(err.code), message: String(err.message), details: (err as any).details };
  }
  return { code: "UNKNOWN", message: asErrorMessage(err) };
}

const PERMANENT_ERROR_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PIN_REQUIRED",
  "NOT_FOUND",
  "SCHEMA_MISSING",
  "EMAIL_EXISTS",
  "INVALID_CREDENTIALS",
  "INVITE_INVALID",
  "INVITE_EXPIRED",
  "INVITE_MAXED",
  "ALREADY_VOIDED",
  "ALREADY_REFUNDED",
  "ALREADY_APPLIED",
  "IDEMPOTENCY_KEY_COLLISION",
  "NEGATIVE_STOCK_NOT_ALLOWED",
]);

export function classifyFailure(err: unknown): "failed_permanent" | "failed_retry" {
  const code = err && typeof err === "object" && "code" in err ? String((err as any).code) : "";
  if (code) {
    if (code.startsWith("INVITE_")) return "failed_permanent";
    if (PERMANENT_ERROR_CODES.has(code)) return "failed_permanent";
  }

  const msg = asErrorMessage(err).toLowerCase();
  // validation / auth / scope errors are permanent
  if (
    msg.includes("required") ||
    msg.includes("invalid") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("not found") ||
    msg.includes("duplicate") ||
    msg.includes("already") ||
    msg.includes("negative stock")
  ) {
    return "failed_permanent";
  }
  return "failed_retry";
}
