/**
 * updateAffiliateProfile — self-verified payout details.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";
import { ok, fail } from "./_response.ts";

function cleanPhone(v: any) {
  const s = String(v || "").trim();
  return s.replace(/[^0-9+]/g, "");
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return fail("UNAUTHORIZED", "Unauthorized", null, 401);

    const body = await req.json();
    const { gcash_number, gcash_name } = body || {};
    const number = cleanPhone(gcash_number);
    const name = String(gcash_name || "").trim();

    const user_id = user.id;

    let existing: any = null;
    try {
      const found = await base44.asServiceRole.entities.AffiliateProfile.filter({ user_id });
      existing = found?.[0] || null;
    } catch (_e) {}

    const payload = {
      user_id,
      email: user.email,
      gcash_number: number,
      gcash_name: name,
      gcash_verified: !!(number && name),
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      await base44.asServiceRole.entities.AffiliateProfile.update(existing.id, payload);
      return ok({ profile: { ...existing, ...payload } });
    }
    const created = await base44.asServiceRole.entities.AffiliateProfile.create({
      ...payload,
      referral_code: `POSYNC-${String(user_id).slice(-6).toUpperCase()}`,
      created_at: new Date().toISOString(),
    });
    return ok({ profile: created });
  } catch (err) {
    return fail("INTERNAL", err?.message || "Unknown error", null, 500);
  }
});
