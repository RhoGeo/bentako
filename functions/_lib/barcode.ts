/**
 * Barcode normalization (server-side)
 * - Preserve leading zeros (treat as string)
 * - Trim spaces
 * - Collapse/remove internal whitespace
 * - Reject non-printable/control characters (return empty string)
 */

export function normalizeBarcode(input: unknown): string {
  const raw = String(input ?? "");
  if (!raw) return "";

  // Reject control characters (non-printable). We keep printable ASCII 32..126.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) return "";
  }

  return raw.trim().replace(/\s+/g, "");
}

/** Throws a BAD_REQUEST-ish error if barcode is invalid after normalization. */
export function normalizeBarcodeOrThrow(input: unknown, fieldName = "barcode"): string {
  const out = normalizeBarcode(input);
  if (!out) {
    throw Object.assign(new Error(`${fieldName} is invalid`), { code: "BAD_REQUEST" });
  }
  return out;
}
