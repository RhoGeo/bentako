/**
 * Best-effort runtime schema verification.
 *
 * Base44 entities are configured on the Base44 backend.
 * This helper allows functions to fail fast with a clear error when a required
 * entity is missing/misnamed.
 */

export const CORE_REQUIRED_BASE44_ENTITIES: ReadonlyArray<string> = [
  "Store",
  // Custom auth (NO Base44 auth)
  "UserAccount",
  "AuthSession",
  "InvitationCode",
  "InvitationCodeUse",
  "ReferralAttribution",
  "Category",
  "Product",
  "Sale",
  "SaleItem",
  "StockLedger",
  "Customer",
  "Payment",
  "StoreMembership",
  "StoreSettings",
  "ActivityEvent",
  "Invite",
  "IdempotencyKey",
  "ReceiptSequence",
];

export const OPTIONAL_BASE44_ENTITIES: ReadonlyArray<string> = [
  "AffiliateProfile",
  "Earnings",
  "PayoutRequest",
  "Payout",
  // Some deployments use this legacy store-staff entity.
  "StaffMember",
];

export function assertRequiredEntitiesExist(base44: any, extraEntities: string[] = []) {
  const ent = base44?.asServiceRole?.entities;
  const missing: string[] = [];
  for (const name of [...CORE_REQUIRED_BASE44_ENTITIES, ...extraEntities]) {
    const api = ent?.[name];
    if (!api || typeof api.filter !== "function" || typeof api.create !== "function") {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw Object.assign(new Error(`Base44 schema missing required entities: ${missing.join(", ")}`), {
      code: "SCHEMA_MISSING",
      details: { missing },
    });
  }
}
