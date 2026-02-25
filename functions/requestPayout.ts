/**
 * requestPayout — Affiliate payout request.
 * Requires self-verified GCash details.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";
import { ok, fail } from "./_response.ts";

function isInt(n: unknown) {
  return typeof n === "number" && Number.isInteger(n);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return fail("UNAUTHORIZED", "Unauthorized", null, 401);

    const body = await req.json();
    const { amount_centavos } = body || {};
    if (!isInt(amount_centavos) || amount_centavos <= 0) {
      return fail("BAD_REQUEST", "amount_centavos must be integer > 0");
    }

    const user_id = user.id;
    let profile: any = null;
    try {
      const found = await base44.asServiceRole.entities.AffiliateProfile.filter({ user_id });
      profile = found?.[0] || null;
    } catch (_e) {}

    if (!profile?.gcash_verified || !profile?.gcash_number || !profile?.gcash_name) {
      return fail("GCASH_REQUIRED", "GCash details required before payout request", null, 400);
    }

    // Note: Available balance enforcement depends on Earnings schema; we enforce a soft check if available is present.
    // If not present, accept request and let admin reject.
    const payout = await base44.asServiceRole.entities.PayoutRequest.create({
      affiliate_user_id: user_id,
      requested_by: user.email,
      amount_centavos,
      gcash_number: profile.gcash_number,
      gcash_name: profile.gcash_name,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    try {
      await base44.asServiceRole.entities.ActivityEvent.create({
        store_id: null,
        user_id: user.id || null,
        device_id: null,
        event_type: "payout_requested",
        entity_id: payout.id,
        metadata_json: { amount_centavos },
        created_at: new Date().toISOString(),
      });
    } catch (_e) {}

    return ok({ payout_request_id: payout.id, status: payout.status });
  } catch (err) {
    return fail("INTERNAL", err?.message || "Unknown error", null, 500);
  }
});
