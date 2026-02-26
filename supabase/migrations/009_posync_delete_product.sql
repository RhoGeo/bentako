-- POSync CS6.1: Product deletion / deactivation
-- - Soft delete (deactivate) products and their variants (if parent)
-- - Clears barcode to allow reuse
-- - Enforced by DB permission checks (inventory_create_edit)

begin;

-- Replace overly-strict barcode uniqueness with an "active sellables only" rule.
-- The original index in 001_posync_schema.sql was:
--   unique(store_id, barcode) where barcode is not null and is_parent=false
-- which prevents reusing barcodes after deactivation.

drop index if exists public.products_store_barcode_sellable_uq;

create unique index if not exists products_store_barcode_sellable_uq
  on public.products(store_id, barcode)
  where barcode is not null
    and barcode <> ''
    and is_parent = false
    and deleted_at is null
    and is_active = true;

-- Transactional product delete (deactivate)
create or replace function public.posync_delete_product(
  p_store_id uuid,
  p_user_id uuid,
  p_product_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_prod public.products%rowtype;
  v_deleted_ids uuid[] := '{}'::uuid[];
  v_now timestamptz := now();
begin
  if p_store_id is null or p_user_id is null or p_product_id is null then
    raise exception 'store_id, user_id, product_id required' using errcode = '22023';
  end if;

  perform public.posync_require_permission(p_store_id, p_user_id, 'inventory_create_edit');

  select * into v_prod
  from public.products
  where store_id = p_store_id
    and product_id = p_product_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_prod.is_parent then
    -- Deactivate variants first
    update public.products
      set is_active = false,
          barcode = null,
          updated_at = v_now
    where store_id = p_store_id
      and parent_product_id = v_prod.product_id
      and deleted_at is null;

    -- Deactivate parent
    update public.products
      set is_active = false,
          barcode = null,
          updated_at = v_now
    where store_id = p_store_id
      and product_id = v_prod.product_id
      and deleted_at is null;

    select array_agg(product_id) into v_deleted_ids
    from public.products
    where store_id = p_store_id
      and (product_id = v_prod.product_id or parent_product_id = v_prod.product_id)
      and deleted_at is null
      and is_active = false;
  else
    update public.products
      set is_active = false,
          barcode = null,
          updated_at = v_now
    where store_id = p_store_id
      and product_id = v_prod.product_id
      and deleted_at is null;

    v_deleted_ids := array[v_prod.product_id];
  end if;

  -- Optional: log to stock_ledger? Not appropriate; this is catalog change.
  return jsonb_build_object(
    'deleted_ids', coalesce(v_deleted_ids, '{}'::uuid[]),
    'product_id', v_prod.product_id,
    'is_parent', v_prod.is_parent,
    'note', nullif(p_note,'')
  );
end;
$$;

revoke all on function public.posync_delete_product(uuid, uuid, uuid, text) from public;

commit;
