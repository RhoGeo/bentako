-- Ensure PostgREST can embed parent product (self-referential relationship)
-- and enforce basic integrity for variants.

begin;

-- 1) Add missing self-FK for products.parent_product_id -> products.product_id
-- NOTE: Some environments created tables earlier (CREATE TABLE IF NOT EXISTS)
-- which does not add constraints retroactively. This migration fixes that.

do $$
declare
  has_fk boolean;
begin
  select exists(
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.products'::regclass
      and c.contype = 'f'
      and a.attname = 'parent_product_id'
      and c.confrelid = 'public.products'::regclass
  ) into has_fk;

  if not has_fk then
    alter table public.products
      add constraint products_parent_product_id_fkey
      foreign key (parent_product_id)
      references public.products(product_id)
      on delete set null
      not valid;
  end if;
end $$;

-- Create an index for parent lookups (variants list)
create index if not exists products_parent_product_id_idx
  on public.products(parent_product_id)
  where parent_product_id is not null;

-- 2) Enforce parent/variant must belong to the same store (multi-tenant safety)
create or replace function public.enforce_products_parent_store_match()
returns trigger
language plpgsql
as $$
declare
  p_store uuid;
  p_is_parent boolean;
begin
  if new.parent_product_id is not null then
    select store_id, is_parent
      into p_store, p_is_parent
    from public.products
    where product_id = new.parent_product_id;

    if not found then
      raise exception 'PARENT_NOT_FOUND';
    end if;

    if p_store <> new.store_id then
      raise exception 'PARENT_STORE_MISMATCH';
    end if;

    if p_is_parent is distinct from true then
      raise exception 'PARENT_NOT_PARENT';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_products_parent_store_match'
      and tgrelid = 'public.products'::regclass
  ) then
    create trigger trg_products_parent_store_match
    before insert or update on public.products
    for each row
    execute function public.enforce_products_parent_store_match();
  end if;
end $$;

-- Attempt to validate the constraint (won't block relationship even if not validated)
do $$
begin
  begin
    alter table public.products validate constraint products_parent_product_id_fkey;
  exception when others then
    -- Leave as NOT VALID if existing data has orphans; PostgREST relationship still exists.
    raise notice 'products_parent_product_id_fkey left NOT VALID: %', sqlerrm;
  end;
end $$;

commit;
