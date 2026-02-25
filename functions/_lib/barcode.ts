/**
 * Barcode normalization (server-side)
 * - Trim spaces
 * - Remove internal whitespace
 * - Remove non-printable characters
 */

export function normalizeBarcode(input: string): string {
  const raw = (input || "").toString().trim();
  if (!raw) return "";
  // Keep printable ASCII + common digits/letters; strip control chars.
  const printable = raw
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join("");
  return printable.replace(/\s+/g, "");
}
