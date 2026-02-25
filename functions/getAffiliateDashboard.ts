/**
 * getAffiliateDashboard — affiliate profile + earnings + payouts.
 *
 * Spec Step 12.2:
 * - Any user can be an affiliate (even without a store)
 * - Payouts: GCash self-verified required before payout request
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";
import { ok, fail } from "./_response.ts";
import { requireAuth } from "./_lib/auth.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { user } = await requireAuth(base44, req);

    // Affiliate is user-scoped.
    const user_id = user.id;
    const email = user.email;

    let profile: any = null;
    try {
      const profiles = await base44.asServiceRole.entities.AffiliateProfile.filter({ user_id });
      profile = profiles?.[0] || null;
    } catch (_e) {}

    let earnings: any[] = [];
    let payouts: any[] = [];
    try {
      earnings = await base44.asServiceRole.entities.Earnings.filter({ affiliate_user_id: user_id });
    } catch (_e) {}
    try {
      payouts = await base44.asServiceRole.entities.PayoutRequest.filter({ affiliate_user_id: user_id });
    } catch (_e) {
      // Back-compat if project used Payout entity
      try { payouts = await base44.asServiceRole.entities.Payout.filter({ affiliate_user_id: user_id }); } catch (_e2) {}
    }

    const totalEarned = (earnings || []).reduce((s, e) => s + Number(e.amount_centavos || 0), 0);
    const totalPaidOut = (payouts || []).filter((p) => p.status === "completed").reduce((s, p) => s + Number(p.amount_centavos || 0), 0);
    const pending = (payouts || []).filter((p) => p.status === "pending" || p.status === "processing").reduce((s, p) => s + Number(p.amount_centavos || 0), 0);
    const available = Math.max(0, totalEarned - totalPaidOut - pending);

    const referral_code = profile?.referral_code || `POSYNC-${String(user_id || email || "USER").slice(-6).toUpperCase()}`;

    return ok({
      profile: profile || { user_id, email, referral_code, gcash_number: "", gcash_name: "", gcash_verified: false },
      totals: { total_earned_centavos: totalEarned, pending_centavos: pending, available_centavos: available },
      payouts: payouts || [],
    });
  } catch (err) {
    return fail("INTERNAL", err?.message || "Unknown error", null, 500);
  }
});
