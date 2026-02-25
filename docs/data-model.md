# POSync Data Model (Server / Base44 Entities)

This project uses Base44 entities for persistence.

**Hard rule:** All store-scoped entities MUST include `store_id` and every query MUST filter by `store_id`.

## Store-scoped fields (required on every store-scoped entity)

- `store_id: string`
- `created_by: string`
- `created_at: ISO timestamp`
- `updated_at: ISO timestamp`

## Money fields

All money is stored as **integer centavos**.

- Example: `₱12.34 → 1234`

## Product: parent vs sellable (variant/single)

- `product_type = "parent"`
  - container only
  - **NOT sellable**
  - **MUST NOT** have: `barcode`, `selling_price_centavos`, `cost_price_centavos`, `stock_quantity`
- `product_type = "single"`
  - sellable item or variant
  - may have `parent_id` (variant) or `null` (standalone)

## Barcode constraints

- `barcode` is a **string** (preserve leading zeros).
- Normalization (server):
  - trim
  - remove internal whitespace
  - reject non-printables/control characters
- Uniqueness:
  - **Unique per store** for **sellable items only** (`product_type="single"`)
  - parent products are excluded from lookup + uniqueness.

## Custom Auth entities (REQUIRED)

> **Auth MUST NOT use Base44 built-in auth.**

### UserAccount

- `user_id` (UUID)
- `full_name`
- `phone_number`
- `email`
- `email_canonical` (lower-case for uniqueness)
- `password_hash`
- `is_active`
- timestamps

### AuthSession

- `session_id` (UUID)
- `user_id`
- `device_id`
- `refresh_token_hash` (or server session secret)
- `expires_at`
- `revoked_at?`
- timestamps

### InvitationCode

- `invitation_code_id` (UUID)
- `code` (unique)
- `type: affiliate_referral | staff_invite`
- `store_id?` (**required for staff_invite**)
- `role?` (staff_invite)
- `permission_set_id?`
- `affiliate_profile_id?` (**required for affiliate_referral**)
- `max_uses`, `used_count`
- `expires_at?`
- `created_by`
- timestamps

### InvitationCodeUse

- `invitation_code_id`
- `used_by_user_id`
- `used_at`
- `metadata_json?`

## Source of truth

The canonical type definitions live in:

- `functions/_lib/dataModel.ts`
