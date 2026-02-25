import { asErrorMessage } from "./response.ts";

export function toApiError(err: unknown): { code: string; message: string; details?: unknown } {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    // passthrough
    // @ts-ignore
    return { code: String(err.code), message: String(err.message), details: (err as any).details };
  }
  return { code: "UNKNOWN", message: asErrorMessage(err) };
}

export function classifyFailure(err: unknown): "failed_permanent" | "failed_retry" {
  const msg = asErrorMessage(err).toLowerCase();
  // validation / auth errors are permanent
  if (
    msg.includes("required") ||
    msg.includes("invalid") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("not found") ||
    msg.includes("duplicate")
  ) {
    return "failed_permanent";
  }
  return "failed_retry";
}
