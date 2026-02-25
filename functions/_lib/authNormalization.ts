/**
 * Auth-specific normalization helpers.
 *
 * Requirements (Master Prompt):
 * - Email uniqueness must be case-insensitive.
 * - Never store plaintext passwords.
 */

/** Normalize email for storage + uniqueness. */
export function normalizeEmail(input: unknown): { email: string; email_canonical: string } {
  const email = String(input ?? "").trim();
  const email_canonical = email.toLowerCase();
  return { email, email_canonical };
}

/** Very small validation for "human-typable" codes: letters/digits/hyphen/underscore. */
export function normalizeInvitationCode(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return raw.toUpperCase().replace(/\s+/g, "");
}
