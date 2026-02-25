-- POSync Supabase Schema (custom auth + offline-first POS)
-- Paste into Supabase SQL editor or run via supabase migrations.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.gen_store_code()
returns text
language sql
stable
as $$
  select upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
$$;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.store_role AS ENUM ('owner','manager','cashier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invitation_code_type AS ENUM ('affiliate_referral','staff_invite');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sale_type AS ENUM ('counter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sale_status AS ENUM ('parked','completed','due','voided','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM ('cash','gcash','bank_transfer','card','mixed','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stock_adjust_reason AS ENUM (
    'restock','damaged','expired','lost','cycle_count','manual_correction','return_from_customer','return_to_supplier',
    'sale_completed','sale_voided','sale_refunded','refund_to_customer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payout_status AS ENUM ('requested','approved','rejected','paid','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.device_status AS ENUM ('allowed','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Custom auth
create table if not exists public.user_accounts (
  user_id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_number text not null,
  email text not null,
  email_canonical citext generated always as (lower(email)::citext) stored,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_accounts_email_canonical_uq
  on public.user_accounts(email_canonical);

create trigger trg_user_accounts_updated_at
before update on public.user_accounts
for each row execute function public.set_updated_at();

create table if not exists public.auth_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_accounts(user_id) on delete cascade,
  device_id uuid not null,
  access_token_hash text not null,
  refresh_token_hash text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auth_sessions_access_token_hash_uq on public.auth_sessions(access_token_hash);
create unique index if not exists auth_sessions_refresh_token_hash_uq on public.auth_sessions(refresh_token_hash);
create index if not exists auth_sessions_user_id_idx on public.auth_sessions(user_id);

create trigger trg_auth_sessions_updated_at
before update on public.auth_sessions
for each row execute function public.set_updated_at();

create table if not exists public.affiliate_profiles (
  affiliate_profile_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.user_accounts(user_id) on delete cascade,
  display_name text null,
  gcash_number text null,
  gcash_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_affiliate_profiles_updated_at
before update on public.affiliate_profiles
for each row execute function public.set_updated_at();

create table if not exists public.invitation_codes (
  invitation_code_id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type public.invitation_code_type not null,
  store_id uuid null,
  role public.store_role null,
  permission_set_id uuid null,
  affiliate_profile_id uuid null references public.affiliate_profiles(affiliate_profile_id) on delete cascade,
  max_uses int not null default 1,
  used_count int not null default 0,
  expires_at timestamptz null,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_code_staff_invite_store_chk check ((type <> 'staff_invite') or (store_id is not null)),
  constraint invitation_code_affiliate_ref_profile_chk check ((type <> 'affiliate_referral') or (affiliate_profile_id is not null))
);

create trigger trg_invitation_codes_updated_at
before update on public.invitation_codes
for each row execute function public.set_updated_at();

create table if not exists public.invitation_code_uses (
  invitation_code_use_id uuid primary key default gen_random_uuid(),
  invitation_code_id uuid not null references public.invitation_codes(invitation_code_id) on delete cascade,
  used_by_user_id uuid not null references public.user_accounts(user_id) on delete cascade,
  used_at timestamptz not null default now(),
  metadata_json jsonb null
);

create table if not exists public.referral_attributions (
  referral_attribution_id uuid primary key default gen_random_uuid(),
  affiliate_profile_id uuid not null references public.affiliate_profiles(affiliate_profile_id) on delete restrict,
  referred_user_id uuid not null unique references public.user_accounts(user_id) on delete cascade,
  invitation_code_id uuid null references public.invitation_codes(invitation_code_id) on delete set null,
  created_at timestamptz not null default now()
);

-- Stores
create table if not exists public.stores (
  store_id uuid primary key default gen_random_uuid(),
  store_code text not null unique default public.gen_store_code(),
  store_name text not null,
  low_stock_threshold_default int not null default 5,
  allow_negative_stock boolean not null default false,
  owner_pin_hash text null,
  store_settings_json jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create trigger trg_stores_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

create table if not exists public.permission_sets (
  permission_set_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  permissions_json jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_permission_sets_updated_at
before update on public.permission_sets
for each row execute function public.set_updated_at();

create table if not exists public.store_memberships (
  store_membership_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  user_id uuid not null references public.user_accounts(user_id) on delete cascade,
  role public.store_role not null default 'cashier',
  permission_set_id uuid null references public.permission_sets(permission_set_id) on delete set null,
  overrides_json jsonb null,
  is_active boolean not null default true,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_memberships_store_user_uq on public.store_memberships(store_id,user_id);
create trigger trg_store_memberships_updated_at
before update on public.store_memberships
for each row execute function public.set_updated_at();

create table if not exists public.store_referrals (
  store_referral_id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(store_id) on delete cascade,
  applied_referral_code text not null,
  referral_discount_percent int not null default 10,
  applied_by_user_id uuid not null references public.user_accounts(user_id),
  applied_at timestamptz not null default now()
);

-- Catalog
create table if not exists public.categories (
  category_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create trigger trg_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create table if not exists public.products (
  product_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  is_parent boolean not null default false,
  parent_product_id uuid null references public.products(product_id) on delete set null,
  category_id uuid null references public.categories(category_id) on delete set null,
  name text not null,
  description text null,
  sku text null,
  barcode text null,
  track_stock boolean not null default true,
  stock_quantity int null default 0,
  price_centavos int null,
  cost_price_centavos int null,
  low_stock_threshold int null,
  is_active boolean not null default true,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint products_barcode_printable_chk check (barcode is null or barcode ~ '^[[:print:]]+$'),
  constraint products_parent_rules_chk check (
    (is_parent = false)
    or (
      is_parent = true
      and parent_product_id is null
      and barcode is null
      and price_centavos is null
      and cost_price_centavos is null
      and track_stock = false
      and stock_quantity is null
    )
  ),
  constraint products_variant_not_parent_chk check (parent_product_id is null or is_parent = false),
  constraint products_money_nonneg_chk check (
    (price_centavos is null or price_centavos >= 0)
    and (cost_price_centavos is null or cost_price_centavos >= 0)
  )
);

create unique index if not exists products_store_barcode_sellable_uq
  on public.products(store_id, barcode)
  where barcode is not null and is_parent = false;

create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- Customers
create table if not exists public.customers (
  customer_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  phone text null,
  address text null,
  allow_utang boolean not null default true,
  credit_limit_centavos int null,
  balance_due_centavos int not null default 0,
  notes text null,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint customers_money_chk check (balance_due_centavos >= 0 and (credit_limit_centavos is null or credit_limit_centavos >= 0))
);

create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

-- Sales & items
create table if not exists public.sales (
  sale_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  sale_type public.sale_type not null default 'counter',
  status public.sale_status not null default 'completed',
  client_tx_id text null,
  device_id uuid null,
  receipt_number text null,
  customer_id uuid null references public.customers(customer_id) on delete set null,
  subtotal_centavos int not null default 0,
  discount_centavos int not null default 0,
  total_centavos int not null default 0,
  notes text null,
  completed_at timestamptz null,
  voided_at timestamptz null,
  refunded_at timestamptz null,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint sales_money_chk check (subtotal_centavos >= 0 and discount_centavos >= 0 and total_centavos >= 0)
);

create unique index if not exists sales_store_client_tx_uq on public.sales(store_id, client_tx_id) where client_tx_id is not null;
create trigger trg_sales_updated_at
before update on public.sales
for each row execute function public.set_updated_at();

create table if not exists public.sale_items (
  sale_item_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  sale_id uuid not null references public.sales(sale_id) on delete cascade,
  product_id uuid not null references public.products(product_id) on delete restrict,
  qty numeric(12,3) not null,
  unit_price_centavos int not null,
  line_discount_centavos int not null default 0,
  cost_price_snapshot_centavos int null,
  created_at timestamptz not null default now(),
  constraint sale_items_qty_chk check (qty > 0),
  constraint sale_items_money_chk check (
    unit_price_centavos >= 0 and line_discount_centavos >= 0 and (cost_price_snapshot_centavos is null or cost_price_snapshot_centavos >= 0)
  )
);

create table if not exists public.payment_ledger (
  payment_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  sale_id uuid null references public.sales(sale_id) on delete cascade,
  customer_id uuid null references public.customers(customer_id) on delete set null,
  method public.payment_method not null,
  amount_centavos int not null,
  is_refund boolean not null default false,
  notes text null,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  constraint payment_amount_chk check (amount_centavos >= 0)
);

-- Stock ledger & idempotency
create table if not exists public.stock_ledger (
  stock_ledger_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  product_id uuid not null references public.products(product_id) on delete restrict,
  delta_qty int not null,
  reason public.stock_adjust_reason not null,
  mutation_key text not null,
  reference_type text null,
  reference_id uuid null,
  notes text null,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  constraint stock_ledger_delta_nonzero_chk check (delta_qty <> 0)
);

create unique index if not exists stock_ledger_store_mutation_uq on public.stock_ledger(store_id, mutation_key);

create table if not exists public.idempotency_keys (
  idempotency_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  key_type text not null,
  key text not null,
  request_hash text null,
  status text not null default 'applied',
  result_json jsonb null,
  error_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idempotency_keys_store_type_key_uq on public.idempotency_keys(store_id, key_type, key);
create trigger trg_idempotency_keys_updated_at
before update on public.idempotency_keys
for each row execute function public.set_updated_at();

-- Receipt sequence
create table if not exists public.receipt_sequences (
  store_id uuid primary key references public.stores(store_id) on delete cascade,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now()
);

create or replace function public.next_receipt_number(p_store_id uuid)
returns text
language plpgsql
as $$
declare
  v_store_code text;
  v_next bigint;
begin
  select store_code into v_store_code from public.stores where store_id = p_store_id;
  if v_store_code is null then
    raise exception 'Store not found for receipt sequence';
  end if;

  insert into public.receipt_sequences(store_id, next_number)
  values (p_store_id, 1)
  on conflict (store_id) do nothing;

  select next_number into v_next
  from public.receipt_sequences
  where store_id = p_store_id
  for update;

  update public.receipt_sequences
    set next_number = v_next + 1,
        updated_at = now()
  where store_id = p_store_id;

  return v_store_code || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- Activity
create table if not exists public.activity_events (
  activity_event_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  user_id uuid null references public.user_accounts(user_id) on delete set null,
  device_id uuid null,
  event_type text not null,
  entity_type text null,
  entity_id text null,
  description text null,
  amount_centavos int null,
  metadata_json jsonb null,
  created_at timestamptz not null default now()
);

-- Devices
create table if not exists public.devices (
  device_row_id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  user_id uuid not null references public.user_accounts(user_id) on delete cascade,
  store_id uuid null references public.stores(store_id) on delete set null,
  device_name text null,
  status public.device_status not null default 'allowed',
  last_seen_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists devices_user_device_uq on public.devices(user_id, device_id);
create trigger trg_devices_updated_at
before update on public.devices
for each row execute function public.set_updated_at();

commit;
