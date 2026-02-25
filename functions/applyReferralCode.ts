import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireActiveStaff } from "./_lib/staff.ts";
import { requirePermission } from "./_lib/guard.ts";
import { getStoreSettings } from "./_lib/storeSettings.ts";

const DISCOUNT_PERCENT = 10;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");

    const body = await req.json();
    const store_id = body?.store_id;
    const referral_code = (body?.referral_code || "").toString().trim();
    if (!store_id || !referral_code) return jsonFail(400, "BAD_REQUEST", "store_id and referral_code required");

    const staff = await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);
    requirePermission(staff, "referral_apply_code");

    const settings = await getStoreSettings(base44, store_id);
    if (settings?.referral_code_applied) {
      return jsonFail(409, "REFERRAL_ALREADY_APPLIED", "Referral code already applied");
    }

    if (settings?.id) {
      await base44.asServiceRole.entities.StoreSettings.update(settings.id, {
        referral_code_applied: referral_code,
        referral_code_applied_date: new Date().toISOString(),
        referral_discount_percent: DISCOUNT_PERCENT,
      });
    } else {
      await base44.asServiceRole.entities.StoreSettings.create({
        store_id,
        referral_code_applied: referral_code,
        referral_code_applied_date: new Date().toISOString(),
        referral_discount_percent: DISCOUNT_PERCENT,
      });
    }

    return jsonOk({ store_id, referral_code_applied: referral_code, discount_percent: DISCOUNT_PERCENT });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
