/**
 * POSync Server Data Model (Base44 Entities)
 *
 * This file is the single source-of-truth for the entity shapes and rules
 * required by the POSync master build prompt.
 *
 * Notes:
 * - Base44 entities are schemaless at runtime; this file documents the
 *   required columns/fields that MUST exist on the Base44 side.
 * - Every store-scoped entity MUST contain: store_id, created_by, created_at, updated_at.
 * - All money fields are integer centavos.
 */

export type ISODateString = string;
export type UUID = string;

export type MoneyCentavos = number;
export type Qty = number;

/** Store scoping required on all store-scoped entities. */
export type StoreScoped = {
  store_id: string;
  created_by: string;
  created_at: ISODateString;
  updated_at: ISODateString;
};

/**
 * Core Store
 */
export type Store = StoreScoped & {
  id: string;
  store_name: string;
  owner_user_id?: UUID | null;
  low_stock_threshold_default?: number | null;
  allow_negative_stock?: boolean | null;
  owner_pin_hash?: string | null;
};

export type Category = StoreScoped & {
  id: string;
  name: string;
  sort_order?: number | null;
  is_active?: boolean | null;
};

export type ProductType = "parent" | "single";

/**
 * Product rules:
 * - parent: container only, NOT sellable, hidden by default, NO price/stock/barcode
 * - single: sellable variant/subitem or standalone item
 */
export type Product = StoreScoped & {
  id: string;

  name: string;
  category_id?: string | null;
  category?: string | null; // legacy UI field

  product_type: ProductType;
  parent_id?: string | null;
  is_active?: boolean | null;

  // Sellable-only fields (must be empty/0 when product_type === "parent")
  barcode?: string | null;
  selling_price_centavos?: MoneyCentavos | null;
  cost_price_centavos?: MoneyCentavos | null;
  track_stock?: boolean | null;
  stock_quantity?: Qty | null;

  // Legacy aliases currently used by UI
  stock_qty?: Qty | null;
  low_stock_threshold?: number | null;

  // Crash-safe stock mutation tracking
  pending_stock_mutations?: any[] | null;
};

export type SaleStatus = "completed" | "due" | "voided" | "refunded" | "parked";
export type SaleType = "counter" | "delivery" | "other";

export type Sale = StoreScoped & {
  id: string;
  device_id: string;
  client_tx_id: string;

  sale_type: SaleType;
  status: SaleStatus;
  sale_date: ISODateString;

  cashier_email?: string | null;
  cashier_name?: string | null;

  items: Array<{
    product_id: string;
    qty: Qty;
    unit_price_centavos: MoneyCentavos;
    line_discount_centavos: MoneyCentavos;
  }>;

  subtotal_centavos: MoneyCentavos;
  discount_centavos: MoneyCentavos;
  total_centavos: MoneyCentavos;
  amount_paid_centavos: MoneyCentavos;
  change_centavos: MoneyCentavos;
  balance_due_centavos: MoneyCentavos;

  payments: Array<{ method: string; amount_centavos: MoneyCentavos }>;
  customer_id?: string | null;
  notes?: string | null;
  receipt_number?: string | null;

  // Sync + offline
  is_synced?: boolean | null;
};

export type SaleItem = StoreScoped & {
  id: string;
  sale_id: string;
  product_id: string;
  qty: Qty;
  unit_price_centavos: MoneyCentavos;
  line_discount_centavos: MoneyCentavos;
  /** MUST capture cost at time of sale for gross profit reporting. */
  cost_price_snapshot_centavos: MoneyCentavos;
};

export type StockLedgerReason =
  | "sale"
  | "void"
  | "refund"
  | "restock"
  | "damaged"
  | "expired"
  | "lost"
  | "cycle_count"
  | "manual_correction"
  | "return_from_customer"
  | "return_to_supplier";

export type StockLedger = StoreScoped & {
  id: string;
  product_id: string;
  mutation_key: string;
  qty_delta: Qty;
  prev_qty: Qty;
  resulting_qty: Qty;
  reason: StockLedgerReason;
  reference_type: string;
  reference_id: string;
  device_id?: string | null;
  client_tx_id?: string | null;
  created_at_device?: number | null;
};

export type Customer = StoreScoped & {
  id: string;
  name: string;
  phone_number?: string | null;
  address?: string | null;
  allow_utang?: boolean | null;
  credit_limit_centavos?: MoneyCentavos | null;
  balance_due_centavos?: MoneyCentavos | null;
  last_transaction_date?: ISODateString | null;
};

export type PaymentMethod = "cash" | "gcash" | "bank_transfer" | "card" | "mixed" | "other";

export type Payment = StoreScoped & {
  id: string;
  sale_id: string;
  method: PaymentMethod | string;
  amount_centavos: MoneyCentavos;
  device_id?: string | null;
  client_tx_id?: string | null;
};

export type PermissionRole = "owner" | "manager" | "cashier";

export type StoreMembership = StoreScoped & {
  id: string;
  store_id: string;
  user_id: UUID;
  role: PermissionRole;
  overrides_json?: Record<string, boolean> | null;
  is_active?: boolean | null;
};

export type PermissionSet = StoreScoped & {
  id: string;
  name: string;
  permissions_json: Record<string, boolean>;
};

export type Invite = StoreScoped & {
  id: string;
  store_id: string;
  code: string;
  role?: PermissionRole | null;
  permission_set_id?: string | null;
  max_uses?: number | null;
  used_count?: number | null;
  expires_at?: ISODateString | null;
  is_active?: boolean | null;
};

export type ActivityEvent = StoreScoped & {
  id: string;
  user_id?: UUID | null;
  device_id?: UUID | null;
  event_type: string;
  entity_id?: string | null;
  metadata_json?: any;
};

export type Notification = StoreScoped & {
  id: string;
  user_id?: UUID | null;
  type: string;
  message: string;
  read_at?: ISODateString | null;
};

export type Device = StoreScoped & {
  id: UUID;
  device_id: UUID;
  name?: string | null;
  last_seen_at?: ISODateString | null;
  allowed?: boolean | null;
};

// Affiliate / Referral / Payouts
export type AffiliateProfile = StoreScoped & {
  id: string;
  user_id: UUID;
  display_name?: string | null;
  gcash_number?: string | null;
  is_gcash_verified?: boolean | null;
};

export type ReferralAttribution = StoreScoped & {
  id: string;
  affiliate_profile_id: string;
  referred_user_id: UUID;
  invitation_code_id?: string | null;
  created_at: ISODateString;
};

export type Earnings = StoreScoped & {
  id: string;
  affiliate_profile_id: string;
  amount_centavos: MoneyCentavos;
  status: "pending" | "available" | "paid";
  reference_type?: string | null;
  reference_id?: string | null;
};

export type PayoutRequest = StoreScoped & {
  id: string;
  affiliate_profile_id: string;
  amount_centavos: MoneyCentavos;
  status: "requested" | "approved" | "rejected" | "paid";
  payout_method: "gcash" | "bank_transfer" | "other";
};

// Optional / Recommended
export type StockCountSession = StoreScoped & {
  id: string;
  status: "draft" | "in_progress" | "finalized";
  started_at?: ISODateString | null;
  finalized_at?: ISODateString | null;
};

export type Supplier = StoreScoped & {
  id: string;
  name: string;
  phone_number?: string | null;
  notes?: string | null;
};

export type Restock = StoreScoped & {
  id: string;
  supplier_id?: string | null;
  product_id: string;
  qty: Qty;
  cost_price_centavos?: MoneyCentavos | null;
};

// Sync support
export type IdempotencyKey = StoreScoped & {
  id: string;
  key_type: string;
  key: string;
  status: "processing" | "applied" | "failed";
  result_json?: any;
  last_error?: string | null;
};

export type ReceiptSequence = StoreScoped & {
  id: string;
  store_id: string;
  next_number: number;
};

// Custom Auth (NO Base44 auth) — Step 2 implements endpoints.
export type UserAccount = {
  user_id: UUID;
  full_name: string;
  phone_number: string;
  email: string;
  email_canonical: string;
  password_hash: string;
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
};

export type AuthSession = {
  session_id: UUID;
  user_id: UUID;
  device_id: UUID;
  refresh_token_hash: string;
  expires_at: ISODateString;
  revoked_at?: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
};

export type InvitationCodeType = "affiliate_referral" | "staff_invite";

export type InvitationCode = {
  invitation_code_id: UUID;
  code: string;
  type: InvitationCodeType;
  store_id?: string | null; // required for staff_invite
  role?: PermissionRole | null;
  permission_set_id?: string | null;
  affiliate_profile_id?: string | null; // required for affiliate_referral
  max_uses?: number | null;
  used_count?: number | null;
  expires_at?: ISODateString | null;
  created_by: UUID;
  created_at: ISODateString;
  updated_at: ISODateString;
};

export type InvitationCodeUse = {
  invitation_code_id: UUID;
  used_by_user_id: UUID;
  used_at: ISODateString;
  metadata_json?: any;
};
