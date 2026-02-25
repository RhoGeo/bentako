export function normalizeEmail(input: unknown): { email: string; email_canonical: string } {
  const email = String(input ?? "").trim();
  const email_canonical = email.toLowerCase();
  return { email, email_canonical };
}

export function normalizeInvitationCode(input: unknown): string {
  return String(input ?? "").trim().toUpperCase();
}
