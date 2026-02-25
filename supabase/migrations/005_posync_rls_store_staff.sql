-- Change Set 4: RLS hardening + Store/Staff support
-- This migration adds a small amount of schema needed by the CS4 UI/functions
-- and enables Row Level Security on all store-scoped tables.

begin;

-- Store lifecycle
alter table public.stores
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null references public.user_accounts(user_id);

create index if not exists stores_archived_at_idx on public.stores(archived_at);

-- Invitation enhancements (staff invites)
alter table public.invitation_codes
  add column if not exists invite_email text null,
  add column if not exists revoked_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invitation_code_staff_invite_email_chk'
  ) then
    alter table public.invitation_codes
      add constraint invitation_code_staff_invite_email_chk
      check ((type <> 'staff_invite') or (invite_email is not null));
  end if;
end $$;

create index if not exists invitation_codes_store_type_idx on public.invitation_codes(store_id, type);
create index if not exists invitation_codes_revoked_at_idx on public.invitation_codes(revoked_at);

-- -----------------------------------------------------------------------------
-- RLS helpers
-- -----------------------------------------------------------------------------

create or replace function public.posync_is_store_member(p_store_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.store_memberships m
    where m.store_id = p_store_id
      and m.user_id = auth.uid()
      and m.is_active = true
  );
$$;

create or replace function public.posync_is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.store_memberships m
    where m.store_id = p_store_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role = 'owner'
  );
$$;

-- -----------------------------------------------------------------------------
-- Enable RLS (defense-in-depth)
-- -----------------------------------------------------------------------------

-- Stores
alter table public.stores enable row level security;
alter table public.stores force row level security;

drop policy if exists stores_member_select on public.stores;
create policy stores_member_select on public.stores
  for select
  using (public.posync_is_store_member(store_id));

drop policy if exists stores_owner_update on public.stores;
create policy stores_owner_update on public.stores
  for update
  using (public.posync_is_store_owner(store_id))
  with check (public.posync_is_store_owner(store_id));

-- Memberships
alter table public.store_memberships enable row level security;
alter table public.store_memberships force row level security;

drop policy if exists memberships_member_select on public.store_memberships;
create policy memberships_member_select on public.store_memberships
  for select
  using (public.posync_is_store_member(store_id));

drop policy if exists memberships_owner_mutate on public.store_memberships;
create policy memberships_owner_mutate on public.store_memberships
  for all
  using (public.posync_is_store_owner(store_id))
  with check (public.posync_is_store_owner(store_id));

-- Categories
alter table public.categories enable row level security;
alter table public.categories force row level security;
drop policy if exists categories_member_all on public.categories;
create policy categories_member_all on public.categories
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Products
alter table public.products enable row level security;
alter table public.products force row level security;
drop policy if exists products_member_all on public.products;
create policy products_member_all on public.products
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Customers
alter table public.customers enable row level security;
alter table public.customers force row level security;
drop policy if exists customers_member_all on public.customers;
create policy customers_member_all on public.customers
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Sales
alter table public.sales enable row level security;
alter table public.sales force row level security;
drop policy if exists sales_member_all on public.sales;
create policy sales_member_all on public.sales
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Sale items
alter table public.sale_items enable row level security;
alter table public.sale_items force row level security;
drop policy if exists sale_items_member_all on public.sale_items;
create policy sale_items_member_all on public.sale_items
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Payment ledger
alter table public.payment_ledger enable row level security;
alter table public.payment_ledger force row level security;
drop policy if exists payment_ledger_member_all on public.payment_ledger;
create policy payment_ledger_member_all on public.payment_ledger
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Stock ledger
alter table public.stock_ledger enable row level security;
alter table public.stock_ledger force row level security;
drop policy if exists stock_ledger_member_all on public.stock_ledger;
create policy stock_ledger_member_all on public.stock_ledger
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Idempotency keys (sync safety)
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;
drop policy if exists idempotency_keys_member_all on public.idempotency_keys;
create policy idempotency_keys_member_all on public.idempotency_keys
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Devices
alter table public.devices enable row level security;
alter table public.devices force row level security;
drop policy if exists devices_member_all on public.devices;
create policy devices_member_all on public.devices
  for all
  using (public.posync_is_store_member(store_id))
  with check (public.posync_is_store_member(store_id));

-- Invites: owner-controlled only (invitees join via Edge Function using service role)
alter table public.invitation_codes enable row level security;
alter table public.invitation_codes force row level security;
drop policy if exists invitation_codes_owner_all on public.invitation_codes;
create policy invitation_codes_owner_all on public.invitation_codes
  for all
  using (store_id is not null and public.posync_is_store_owner(store_id))
  with check (store_id is not null and public.posync_is_store_owner(store_id));

alter table public.invitation_code_uses enable row level security;
alter table public.invitation_code_uses force row level security;
drop policy if exists invitation_code_uses_owner_select on public.invitation_code_uses;
create policy invitation_code_uses_owner_select on public.invitation_code_uses
  for select
  using (
    exists (
      select 1
      from public.invitation_codes c
      where c.invitation_code_id = invitation_code_uses.invitation_code_id
        and c.store_id is not null
        and public.posync_is_store_owner(c.store_id)
    )
  );

commit;
