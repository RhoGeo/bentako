-- POSync Step 5/10: Transactional RPCs + ledger helpers for offline sync
--
-- Adds:
-- - customers.last_transaction_date (needed by CustomersDue UI)
-- - payment_ledger.payment_request_id (idempotent recordPayment)
-- - RPCs for atomic event application:
--   * posync_apply_sale
--   * posync_record_payment
--   * posync_adjust_stock
--   * posync_restock_product

begin;

-- UI expects this field for aging buckets; keep nullable.
alter table public.customers
  add column if not exists last_transaction_date timestamptz null;

-- Support idempotent recordPayment events.
alter table public.payment_ledger
  add column if not exists payment_request_id text null;

create unique index if not exists payment_ledger_store_payment_request_uq
  on public.payment_ledger(store_id, payment_request_id)
  where payment_request_id is not null;

-- Helpers
create or replace function public.posync_assert_int_centavos(p_val int, p_field text)
returns void
language plpgsql
as $$
begin
  if p_val is null then
    raise exception '% is required', p_field using errcode = '22004';
  end if;
  if p_val < 0 then
    raise exception '% must be >= 0', p_field using errcode = '22003';
  end if;
end;
$$;

-- Transactional sale apply (completeSale / parkSale)
--
-- p_sale JSON shape (from client):
-- {
--   sale_type: 'counter',
--   status: 'completed' | 'due' | 'parked',
--   items: [{ product_id, qty, unit_price_centavos, line_discount_centavos }],
--   discount_centavos,
--   payments: [{ method, amount_centavos }],
--   customer_id,
--   notes
-- }
create or replace function public.posync_apply_sale(
  p_store_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_client_tx_id text,
  p_sale jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_existing public.sales%rowtype;
  v_store public.stores%rowtype;
  v_status public.sale_status;
  v_sale_type public.sale_type;
  v_sale_id uuid;
  v_receipt text;
  v_subtotal int := 0;
  v_discount int := 0;
  v_total int := 0;
  v_amount_paid int := 0;
  v_change int := 0;
  v_balance_due int := 0;
  v_customer_id uuid := null;
  it jsonb;
  v_product public.products%rowtype;
  v_qty_num numeric;
  v_qty_int int;
  v_unit int;
  v_line_disc int;
  v_line_net int;
  pay jsonb;
  v_method public.payment_method;
  v_pay_amt int;
  v_allow_negative boolean;
  v_new_qty int;
  v_delta int;
  v_mutation_key text;
  v_dup boolean := false;
begin
  if p_store_id is null or p_user_id is null or p_device_id is null or p_client_tx_id is null or length(trim(p_client_tx_id)) = 0 then
    raise exception 'store_id, user_id, device_id, client_tx_id required' using errcode = '22023';
  end if;

  select * into v_store from public.stores where store_id = p_store_id and deleted_at is null;
  if not found then
    raise exception 'Store not found' using errcode = 'P0002';
  end if;
  v_allow_negative := coalesce(v_store.allow_negative_stock, false);

  -- Idempotency by (store_id, client_tx_id)
  select * into v_existing from public.sales where store_id = p_store_id and client_tx_id = p_client_tx_id and deleted_at is null;
  if found then
    v_dup := true;
    v_sale_id := v_existing.sale_id;
    v_receipt := v_existing.receipt_number;
    return jsonb_build_object(
      'duplicate', true,
      'sale_id', v_sale_id,
      'receipt_number', v_receipt,
      'status', v_existing.status,
      'total_centavos', v_existing.total_centavos
    );
  end if;

  v_status := coalesce((p_sale->>'status')::public.sale_status, 'completed');
  v_sale_type := coalesce((p_sale->>'sale_type')::public.sale_type, 'counter');
  v_customer_id := nullif(p_sale->>'customer_id','')::uuid;

  v_discount := coalesce((p_sale->>'discount_centavos')::int, 0);
  perform public.posync_assert_int_centavos(v_discount, 'discount_centavos');

  -- Compute subtotal from items
  if jsonb_typeof(p_sale->'items') <> 'array' then
    raise exception 'sale.items must be an array' using errcode = '22023';
  end if;

  for it in select * from jsonb_array_elements(p_sale->'items') loop
    v_qty_num := coalesce((it->>'qty')::numeric, 0);
    if v_qty_num <= 0 then
      raise exception 'qty must be > 0' using errcode = '22023';
    end if;
    if v_qty_num <> trunc(v_qty_num) then
      raise exception 'qty must be an integer' using errcode = '22023';
    end if;
    v_qty_int := v_qty_num::int;

    v_unit := coalesce((it->>'unit_price_centavos')::int, 0);
    v_line_disc := coalesce((it->>'line_discount_centavos')::int, 0);
    perform public.posync_assert_int_centavos(v_unit, 'unit_price_centavos');
    perform public.posync_assert_int_centavos(v_line_disc, 'line_discount_centavos');

    v_line_net := (v_unit * v_qty_int) - v_line_disc;
    if v_line_net < 0 then
      raise exception 'line total cannot be negative' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + v_line_net;
  end loop;

  perform public.posync_assert_int_centavos(v_subtotal, 'subtotal_centavos');
  v_total := greatest(0, v_subtotal - v_discount);

  -- Payments
  if jsonb_typeof(p_sale->'payments') = 'array' then
    for pay in select * from jsonb_array_elements(p_sale->'payments') loop
      v_method := (pay->>'method')::public.payment_method;
      v_pay_amt := coalesce((pay->>'amount_centavos')::int, 0);
      perform public.posync_assert_int_centavos(v_pay_amt, 'payment.amount_centavos');
      v_amount_paid := v_amount_paid + v_pay_amt;
    end loop;
  end if;

  if v_status = 'completed' then
    v_change := greatest(0, v_amount_paid - v_total);
    v_balance_due := 0;
  elsif v_status = 'due' then
    if v_customer_id is null then
      raise exception 'customer_id required for due sale' using errcode = '22023';
    end if;
    v_change := 0;
    v_balance_due := greatest(0, v_total - least(v_amount_paid, v_total));
  elsif v_status = 'parked' then
    v_change := 0;
    v_balance_due := 0;
  else
    -- Other statuses are not expected here
    raise exception 'Unsupported sale status for posync_apply_sale' using errcode = '22023';
  end if;

  -- Insert sale
  v_receipt := null;
  if v_status in ('completed','due') then
    v_receipt := public.next_receipt_number(p_store_id);
  end if;

  insert into public.sales(
    store_id, sale_type, status, client_tx_id, device_id,
    receipt_number, customer_id,
    subtotal_centavos, discount_centavos, total_centavos,
    notes, completed_at, created_by
  ) values (
    p_store_id, v_sale_type, v_status, p_client_tx_id, p_device_id,
    v_receipt, v_customer_id,
    v_subtotal, v_discount, v_total,
    coalesce(p_sale->>'notes',''),
    case when v_status in ('completed','due') then now() else null end,
    p_user_id
  ) returning sale_id into v_sale_id;

  -- Insert items + adjust stock (atomic)
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    -- Parse again
    v_qty_int := ((it->>'qty')::numeric)::int;
    v_unit := (it->>'unit_price_centavos')::int;
    v_line_disc := coalesce((it->>'line_discount_centavos')::int, 0);

    select * into v_product
    from public.products
    where store_id = p_store_id
      and product_id = (it->>'product_id')::uuid
      and deleted_at is null
    for update;

    if not found then
      raise exception 'Product not found' using errcode = 'P0002';
    end if;
    if v_product.is_parent then
      raise exception 'Parent products are not sellable' using errcode = '22023';
    end if;
    if v_product.is_active is false then
      raise exception 'Product is inactive' using errcode = '22023';
    end if;

    insert into public.sale_items(
      store_id, sale_id, product_id, qty,
      unit_price_centavos, line_discount_centavos, cost_price_snapshot_centavos
    ) values (
      p_store_id, v_sale_id, v_product.product_id, v_qty_int,
      v_unit, v_line_disc, coalesce(v_product.cost_price_centavos, 0)
    );
  end loop;

  if v_status in ('completed','due') then
    -- Group deltas and apply stock once per product.
    for it in
      select (x->>'product_id')::uuid as product_id, sum(((x->>'qty')::numeric)::int) as qty_sum
      from jsonb_array_elements(p_sale->'items') as x
      group by (x->>'product_id')
    loop
      select * into v_product
      from public.products
      where store_id = p_store_id
        and product_id = it.product_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'Product not found' using errcode = 'P0002';
      end if;
      if v_product.track_stock is not true then
        continue;
      end if;

      v_delta := -it.qty_sum;
      v_mutation_key := format('sale::%s::%s', v_sale_id::text, it.product_id::text);

      -- Insert ledger first for idempotent guard (should never conflict because we already guarded by client_tx_id)
      insert into public.stock_ledger(
        store_id, product_id, delta_qty, reason, mutation_key, reference_type, reference_id, created_by
      ) values (
        p_store_id, it.product_id, v_delta, 'sale_completed', v_mutation_key, 'sale', v_sale_id, p_user_id
      );

      v_new_qty := coalesce(v_product.stock_quantity, 0) + v_delta;
      if (not v_allow_negative) and v_new_qty < 0 then
        raise exception 'NEGATIVE_STOCK_NOT_ALLOWED' using errcode = '22023';
      end if;

      update public.products
        set stock_quantity = v_new_qty
      where product_id = it.product_id;
    end loop;
  end if;

  -- Payments ledger
  if jsonb_typeof(p_sale->'payments') = 'array' then
    for pay in select * from jsonb_array_elements(p_sale->'payments') loop
      v_method := (pay->>'method')::public.payment_method;
      v_pay_amt := coalesce((pay->>'amount_centavos')::int, 0);
      if v_pay_amt <= 0 then
        continue;
      end if;
      insert into public.payment_ledger(
        store_id, sale_id, customer_id, method, amount_centavos, created_by
      ) values (
        p_store_id, v_sale_id, v_customer_id, v_method, v_pay_amt, p_user_id
      );
    end loop;
  end if;

  -- Customer balance for due sales
  if v_status = 'due' and v_customer_id is not null and v_balance_due > 0 then
    update public.customers
      set balance_due_centavos = balance_due_centavos + v_balance_due,
          last_transaction_date = now()
    where store_id = p_store_id
      and customer_id = v_customer_id
      and deleted_at is null;
    if not found then
      raise exception 'Customer not found' using errcode = 'P0002';
    end if;
  elsif v_customer_id is not null then
    -- completed sale with customer attached (rare), still bump last_transaction
    update public.customers
      set last_transaction_date = now()
    where store_id = p_store_id
      and customer_id = v_customer_id
      and deleted_at is null;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'sale_id', v_sale_id,
    'receipt_number', v_receipt,
    'status', v_status,
    'subtotal_centavos', v_subtotal,
    'discount_centavos', v_discount,
    'total_centavos', v_total,
    'amount_paid_centavos', v_amount_paid,
    'change_centavos', v_change,
    'balance_due_centavos', v_balance_due
  );
end;
$$;

-- Transactional recordPayment (Step 10)
create or replace function public.posync_record_payment(
  p_store_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_customer_id uuid,
  p_payment_request_id text,
  p_method public.payment_method,
  p_amount_centavos int,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  v_existing jsonb;
  v_payment_id uuid;
  v_new_balance int;
  v_current_balance int;
begin
  if p_store_id is null or p_user_id is null or p_customer_id is null or p_payment_request_id is null or length(trim(p_payment_request_id)) = 0 then
    raise exception 'store_id, user_id, customer_id, payment_request_id required' using errcode = '22023';
  end if;

  -- If already recorded, return stored result
  select result_json into v_existing
  from public.idempotency_keys
  where store_id = p_store_id and key_type = 'recordPayment' and key = p_payment_request_id;

  if v_existing is not null then
    return jsonb_build_object('duplicate', true) || v_existing;
  end if;

  if p_amount_centavos is null or p_amount_centavos <= 0 then
    raise exception 'amount_centavos must be > 0' using errcode = '22023';
  end if;

  select balance_due_centavos into v_current_balance
  from public.customers
  where store_id = p_store_id and customer_id = p_customer_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;

  if p_amount_centavos > v_current_balance then
    raise exception 'PAYMENT_EXCEEDS_BALANCE' using errcode = '22023';
  end if;

  v_new_balance := greatest(0, v_current_balance - p_amount_centavos);

  update public.customers
    set balance_due_centavos = v_new_balance,
        last_transaction_date = now()
  where store_id = p_store_id and customer_id = p_customer_id;

  insert into public.payment_ledger(
    store_id, customer_id, method, amount_centavos, payment_request_id, notes, created_by
  ) values (
    p_store_id, p_customer_id, p_method, p_amount_centavos, p_payment_request_id, nullif(p_note,''), p_user_id
  ) returning payment_id into v_payment_id;

  insert into public.idempotency_keys(store_id, key_type, key, status, result_json)
  values (
    p_store_id,
    'recordPayment',
    p_payment_request_id,
    'applied',
    jsonb_build_object('payment_id', v_payment_id, 'customer_id', p_customer_id, 'new_balance_centavos', v_new_balance)
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment_id', v_payment_id,
    'customer_id', p_customer_id,
    'new_balance_centavos', v_new_balance
  );
end;
$$;

-- Transactional adjustStock
create or replace function public.posync_adjust_stock(
  p_store_id uuid,
  p_user_id uuid,
  p_product_id uuid,
  p_adjustment_id text,
  p_delta_qty int,
  p_reason public.stock_adjust_reason,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  v_product public.products%rowtype;
  v_store public.stores%rowtype;
  v_key text;
  v_new_qty int;
  v_allow_negative boolean;
begin
  if p_store_id is null or p_user_id is null or p_product_id is null or p_adjustment_id is null or length(trim(p_adjustment_id)) = 0 then
    raise exception 'store_id, user_id, product_id, adjustment_id required' using errcode = '22023';
  end if;
  if p_delta_qty is null or p_delta_qty = 0 then
    raise exception 'delta_qty must be non-zero' using errcode = '22023';
  end if;

  select * into v_store from public.stores where store_id = p_store_id and deleted_at is null;
  if not found then
    raise exception 'Store not found' using errcode = 'P0002';
  end if;
  v_allow_negative := coalesce(v_store.allow_negative_stock, false);

  v_key := format('adjustStock::%s', p_adjustment_id);

  -- Idempotency by mutation_key
  begin
    insert into public.stock_ledger(
      store_id, product_id, delta_qty, reason, mutation_key, reference_type, reference_id, notes, created_by
    ) values (
      p_store_id, p_product_id, p_delta_qty, p_reason, v_key, 'adjustment', null, nullif(p_note,''), p_user_id
    );
  exception when unique_violation then
    select stock_quantity into v_new_qty from public.products where store_id = p_store_id and product_id = p_product_id;
    return jsonb_build_object('duplicate', true, 'product_id', p_product_id, 'new_qty', coalesce(v_new_qty,0));
  end;

  select * into v_product
  from public.products
  where store_id = p_store_id and product_id = p_product_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if v_product.is_parent then
    raise exception 'Parent products cannot be adjusted' using errcode = '22023';
  end if;

  v_new_qty := coalesce(v_product.stock_quantity, 0) + p_delta_qty;
  if (not v_allow_negative) and v_new_qty < 0 then
    raise exception 'NEGATIVE_STOCK_NOT_ALLOWED' using errcode = '22023';
  end if;

  update public.products
    set stock_quantity = v_new_qty
  where product_id = p_product_id;

  return jsonb_build_object('duplicate', false, 'product_id', p_product_id, 'new_qty', v_new_qty);
end;
$$;

-- Transactional restockProduct (qty + optional cost update)
create or replace function public.posync_restock_product(
  p_store_id uuid,
  p_user_id uuid,
  p_product_id uuid,
  p_restock_id text,
  p_restock_qty int,
  p_new_cost_centavos int,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  v_product public.products%rowtype;
  v_store public.stores%rowtype;
  v_key text;
  v_new_qty int;
  v_allow_negative boolean;
begin
  if p_store_id is null or p_user_id is null or p_product_id is null or p_restock_id is null or length(trim(p_restock_id)) = 0 then
    raise exception 'store_id, user_id, product_id, restock_id required' using errcode = '22023';
  end if;
  if p_restock_qty is null or p_restock_qty < 0 then
    raise exception 'restock_qty must be >= 0' using errcode = '22023';
  end if;
  if p_new_cost_centavos is not null and p_new_cost_centavos < 0 then
    raise exception 'new_cost_centavos must be >= 0' using errcode = '22023';
  end if;

  select * into v_store from public.stores where store_id = p_store_id and deleted_at is null;
  if not found then
    raise exception 'Store not found' using errcode = 'P0002';
  end if;
  v_allow_negative := coalesce(v_store.allow_negative_stock, false);

  v_key := format('restockProduct::%s::%s', p_product_id::text, p_restock_id);

  -- Idempotency by mutation_key
  begin
    insert into public.stock_ledger(
      store_id, product_id, delta_qty, reason, mutation_key, reference_type, reference_id, notes, created_by
    ) values (
      p_store_id, p_product_id, p_restock_qty, 'restock', v_key, 'restock', null, nullif(p_note,''), p_user_id
    );
  exception when unique_violation then
    select stock_quantity into v_new_qty from public.products where store_id = p_store_id and product_id = p_product_id;
    return jsonb_build_object('duplicate', true, 'product_id', p_product_id, 'new_qty', coalesce(v_new_qty,0));
  end;

  select * into v_product
  from public.products
  where store_id = p_store_id and product_id = p_product_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if v_product.is_parent then
    raise exception 'Parent products cannot be restocked' using errcode = '22023';
  end if;

  if p_new_cost_centavos is not null then
    update public.products
      set cost_price_centavos = p_new_cost_centavos
    where product_id = p_product_id;
  end if;

  v_new_qty := coalesce(v_product.stock_quantity, 0) + p_restock_qty;
  if (not v_allow_negative) and v_new_qty < 0 then
    raise exception 'NEGATIVE_STOCK_NOT_ALLOWED' using errcode = '22023';
  end if;

  update public.products
    set stock_quantity = v_new_qty
  where product_id = p_product_id;

  return jsonb_build_object('duplicate', false, 'product_id', p_product_id, 'new_qty', v_new_qty);
end;
$$;

commit;
