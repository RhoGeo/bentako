begin;
create extension if not exists pgcrypto;
create extension if not exists citext;

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
create unique index if not exists user_accounts_email_canonical_uq on public.user_accounts(email_canonical);

create table if not exists public.auth_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_accounts(user_id) on delete cascade,
  device_id text not null,
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

create table if not exists public.stores (
  store_id uuid primary key default gen_random_uuid(),
  store_name text not null,
  store_code text not null default upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6)),
  store_settings_json jsonb not null default '{}'::jsonb,
  low_stock_threshold_default int not null default 5,
  allow_negative_stock boolean not null default false,
  owner_pin_hash text null,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists stores_store_code_uq on public.stores(store_code);

do $$ begin
  create type public.store_role as enum ('owner','manager','cashier');
exception when duplicate_object then null; end $$;

create table if not exists public.store_memberships (
  store_membership_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  user_id uuid not null references public.user_accounts(user_id) on delete cascade,
  role public.store_role not null default 'cashier',
  permission_set_id uuid null,
  overrides_json jsonb null,
  is_active boolean not null default true,
  created_by uuid not null references public.user_accounts(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists store_memberships_store_user_uq on public.store_memberships(store_id,user_id);

do $$ begin
  create type public.invitation_code_type as enum ('affiliate_referral','staff_invite');
exception when duplicate_object then null; end $$;

create table if not exists public.affiliate_profiles (
  affiliate_profile_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.user_accounts(user_id) on delete cascade,
  display_name text null,
  gcash_number text null,
  gcash_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  updated_at timestamptz not null default now()
);

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

commit;
