export function normalizeBarcode(input: unknown): string {
  const raw = String(input ?? "");
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) return "";
  }
  return raw.trim().replace(/\s+/g, "");
}
