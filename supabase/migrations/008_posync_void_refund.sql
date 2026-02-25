-- Change Set 6: Void/Refund transactional RPCs (atomic inventory + customer balance corrections)

begin;

-- Full void of a sale (completed or due):
-- - status -> voided
-- - restores stock for tracked products
-- - creates refund payment_ledger rows (is_refund=true) for the net amount actually paid at sale time
-- - reverses utang balance increase for due sales (best-effort, clamped to >= 0)
-- - idempotent by (store_id, key_type='voidSale', key=void_request_id)

CREATE OR REPLACE FUNCTION public.posync_void_sale(
  p_store_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_sale_id uuid,
  p_void_request_id text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%rowtype;
  v_customer public.customers%rowtype;
  v_paid_raw int := 0;
  v_refunded_raw int := 0;
  v_refund_net int := 0;
  v_balance_due_at_sale int := 0;
  v_remaining int := 0;
  v_p public.payment_ledger%rowtype;
  v_it record;
  v_product public.products%rowtype;
  v_key jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.posync_require_permission(p_store_id, p_user_id, 'transaction_void');

  IF p_store_id IS NULL OR p_user_id IS NULL OR p_device_id IS NULL OR p_sale_id IS NULL THEN
    RAISE EXCEPTION 'store_id, user_id, device_id, sale_id required' USING ERRCODE = '22023';
  END IF;
  IF p_void_request_id IS NULL OR length(trim(p_void_request_id)) = 0 THEN
    RAISE EXCEPTION 'void_request_id required' USING ERRCODE = '22023';
  END IF;

  -- Idempotency: create the key first to avoid partial double-apply on retries.
  BEGIN
    INSERT INTO public.idempotency_keys(store_id, key_type, key, status)
    VALUES (p_store_id, 'voidSale', p_void_request_id, 'pending');
  EXCEPTION WHEN unique_violation THEN
    SELECT result_json INTO v_key
    FROM public.idempotency_keys
    WHERE store_id = p_store_id AND key_type = 'voidSale' AND key = p_void_request_id;
    RETURN jsonb_build_object('duplicate', true) || COALESCE(v_key, '{}'::jsonb);
  END;

  -- Lock sale row
  SELECT * INTO v_sale
  FROM public.sales
  WHERE store_id = p_store_id AND sale_id = p_sale_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.status NOT IN ('completed','due') THEN
    RAISE EXCEPTION 'SALE_NOT_VOIDABLE' USING ERRCODE = '22023';
  END IF;

  -- Sum payments and already-refunded amounts for this sale (net paid is capped by total)
  SELECT COALESCE(SUM(amount_centavos), 0)
    INTO v_paid_raw
  FROM public.payment_ledger
  WHERE store_id = p_store_id AND sale_id = p_sale_id AND is_refund = false;

  SELECT COALESCE(SUM(amount_centavos), 0)
    INTO v_refunded_raw
  FROM public.payment_ledger
  WHERE store_id = p_store_id AND sale_id = p_sale_id AND is_refund = true;

  v_refund_net := greatest(0, least(v_sale.total_centavos, v_paid_raw) - v_refunded_raw);

  -- For due sales, reverse the balance due added at time of sale (best-effort)
  IF v_sale.status = 'due' AND v_sale.customer_id IS NOT NULL THEN
    v_balance_due_at_sale := greatest(0, v_sale.total_centavos - least(v_paid_raw, v_sale.total_centavos));
  ELSE
    v_balance_due_at_sale := 0;
  END IF;

  -- Restore stock for tracked products
  FOR v_it IN
    SELECT product_id, SUM(qty)::numeric(12,3) AS qty_sum
    FROM public.sale_items
    WHERE store_id = p_store_id AND sale_id = p_sale_id
    GROUP BY product_id
  LOOP
    SELECT * INTO v_product
    FROM public.products
    WHERE store_id = p_store_id AND product_id = v_it.product_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_product.track_stock IS NOT TRUE THEN
      CONTINUE;
    END IF;

    -- Mutation key is deterministic per sale+product. Prevents double apply even if retried.
    BEGIN
      INSERT INTO public.stock_ledger(
        store_id, product_id, delta_qty, reason, mutation_key, reference_type, reference_id, notes, created_by
      ) VALUES (
        p_store_id,
        v_it.product_id,
        (v_it.qty_sum)::int,
        'sale_voided',
        format('void::%s::%s', p_sale_id::text, v_it.product_id::text),
        'sale',
        p_sale_id,
        nullif(p_note,''),
        p_user_id
      );
    EXCEPTION WHEN unique_violation THEN
      -- already restored
      CONTINUE;
    END;

    UPDATE public.products
      SET stock_quantity = COALESCE(stock_quantity, 0) + (v_it.qty_sum)::int
    WHERE store_id = p_store_id AND product_id = v_it.product_id;
  END LOOP;

  -- Reverse customer balance due for due sales
  IF v_balance_due_at_sale > 0 THEN
    SELECT * INTO v_customer
    FROM public.customers
    WHERE store_id = p_store_id AND customer_id = v_sale.customer_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.customers
      SET balance_due_centavos = greatest(0, balance_due_centavos - v_balance_due_at_sale),
          last_transaction_date = now()
    WHERE store_id = p_store_id AND customer_id = v_sale.customer_id;
  END IF;

  -- Create refund ledger rows for net refundable amount, following original payment methods
  v_remaining := v_refund_net;
  IF v_remaining > 0 THEN
    FOR v_p IN
      SELECT *
      FROM public.payment_ledger
      WHERE store_id = p_store_id AND sale_id = p_sale_id AND is_refund = false
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_p.amount_centavos <= 0 THEN
        CONTINUE;
      END IF;
      INSERT INTO public.payment_ledger(
        store_id, sale_id, customer_id, method, amount_centavos, is_refund, notes, created_by
      ) VALUES (
        p_store_id,
        p_sale_id,
        v_sale.customer_id,
        v_p.method,
        LEAST(v_p.amount_centavos, v_remaining),
        true,
        nullif(('VOID: ' || COALESCE(p_note,'')),'VOID: '),
        p_user_id
      );
      v_remaining := v_remaining - LEAST(v_p.amount_centavos, v_remaining);
    END LOOP;
  END IF;

  UPDATE public.sales
    SET status = 'voided',
        voided_at = now()
  WHERE store_id = p_store_id AND sale_id = p_sale_id;

  v_result := jsonb_build_object(
    'sale_id', p_sale_id,
    'status', 'voided',
    'refund_centavos', v_refund_net,
    'reversed_due_centavos', v_balance_due_at_sale
  );

  UPDATE public.idempotency_keys
    SET status = 'applied', result_json = v_result
  WHERE store_id = p_store_id AND key_type = 'voidSale' AND key = p_void_request_id;

  RETURN jsonb_build_object('duplicate', false) || v_result;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE public.idempotency_keys
      SET status = 'failed',
          error_json = jsonb_build_object('message', SQLERRM)
    WHERE store_id = p_store_id AND key_type = 'voidSale' AND key = p_void_request_id;
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
  RAISE;
END;
$$;


-- Full refund of a completed sale:
-- - status -> refunded
-- - restores stock
-- - creates refund payment_ledger rows (is_refund=true) either:
--     a) from p_refund.refunds[] (sum must equal net refundable)
--     b) auto-allocated from original payments
-- - idempotent by refund_request_id

CREATE OR REPLACE FUNCTION public.posync_refund_sale(
  p_store_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_sale_id uuid,
  p_refund_request_id text,
  p_refund jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%rowtype;
  v_paid_raw int := 0;
  v_refunded_raw int := 0;
  v_refund_net int := 0;
  v_remaining int := 0;
  v_p public.payment_ledger%rowtype;
  v_it record;
  v_product public.products%rowtype;
  v_key jsonb;
  v_result jsonb;
  v_has_custom boolean := false;
  v_sum_custom int := 0;
  v_ref jsonb;
  v_method public.payment_method;
  v_amt int;
  v_note text := COALESCE(p_refund->>'note','');
BEGIN
  PERFORM public.posync_require_permission(p_store_id, p_user_id, 'transaction_refund');

  IF p_store_id IS NULL OR p_user_id IS NULL OR p_device_id IS NULL OR p_sale_id IS NULL THEN
    RAISE EXCEPTION 'store_id, user_id, device_id, sale_id required' USING ERRCODE = '22023';
  END IF;
  IF p_refund_request_id IS NULL OR length(trim(p_refund_request_id)) = 0 THEN
    RAISE EXCEPTION 'refund_request_id required' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.idempotency_keys(store_id, key_type, key, status)
    VALUES (p_store_id, 'refundSale', p_refund_request_id, 'pending');
  EXCEPTION WHEN unique_violation THEN
    SELECT result_json INTO v_key
    FROM public.idempotency_keys
    WHERE store_id = p_store_id AND key_type = 'refundSale' AND key = p_refund_request_id;
    RETURN jsonb_build_object('duplicate', true) || COALESCE(v_key, '{}'::jsonb);
  END;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE store_id = p_store_id AND sale_id = p_sale_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'REFUND_ONLY_COMPLETED' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount_centavos), 0)
    INTO v_paid_raw
  FROM public.payment_ledger
  WHERE store_id = p_store_id AND sale_id = p_sale_id AND is_refund = false;

  SELECT COALESCE(SUM(amount_centavos), 0)
    INTO v_refunded_raw
  FROM public.payment_ledger
  WHERE store_id = p_store_id AND sale_id = p_sale_id AND is_refund = true;

  v_refund_net := greatest(0, least(v_sale.total_centavos, v_paid_raw) - v_refunded_raw);

  -- Validate custom refund breakdown if provided
  v_has_custom := (jsonb_typeof(p_refund->'refunds') = 'array');
  IF v_has_custom THEN
    v_sum_custom := 0;
    FOR v_ref IN SELECT * FROM jsonb_array_elements(p_refund->'refunds') LOOP
      v_method := (v_ref->>'method')::public.payment_method;
      v_amt := COALESCE((v_ref->>'amount_centavos')::int, 0);
      PERFORM public.posync_assert_int_centavos(v_amt, 'refund.amount_centavos');
      IF v_amt <= 0 THEN
        CONTINUE;
      END IF;
      v_sum_custom := v_sum_custom + v_amt;
    END LOOP;
    IF v_sum_custom <> v_refund_net THEN
      RAISE EXCEPTION 'REFUND_AMOUNT_MISMATCH' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Restore stock
  FOR v_it IN
    SELECT product_id, SUM(qty)::numeric(12,3) AS qty_sum
    FROM public.sale_items
    WHERE store_id = p_store_id AND sale_id = p_sale_id
    GROUP BY product_id
  LOOP
    SELECT * INTO v_product
    FROM public.products
    WHERE store_id = p_store_id AND product_id = v_it.product_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_product.track_stock IS NOT TRUE THEN
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO public.stock_ledger(
        store_id, product_id, delta_qty, reason, mutation_key, reference_type, reference_id, notes, created_by
      ) VALUES (
        p_store_id,
        v_it.product_id,
        (v_it.qty_sum)::int,
        'sale_refunded',
        format('refund::%s::%s', p_sale_id::text, v_it.product_id::text),
        'sale',
        p_sale_id,
        nullif(v_note,''),
        p_user_id
      );
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
    UPDATE public.products
      SET stock_quantity = COALESCE(stock_quantity, 0) + (v_it.qty_sum)::int
    WHERE store_id = p_store_id AND product_id = v_it.product_id;
  END LOOP;

  -- Insert refund payments
  IF v_refund_net > 0 THEN
    IF v_has_custom THEN
      FOR v_ref IN SELECT * FROM jsonb_array_elements(p_refund->'refunds') LOOP
        v_method := (v_ref->>'method')::public.payment_method;
        v_amt := COALESCE((v_ref->>'amount_centavos')::int, 0);
        IF v_amt <= 0 THEN CONTINUE; END IF;
        INSERT INTO public.payment_ledger(
          store_id, sale_id, customer_id, method, amount_centavos, is_refund, notes, created_by
        ) VALUES (
          p_store_id,
          p_sale_id,
          v_sale.customer_id,
          v_method,
          v_amt,
          true,
          nullif(('REFUND: ' || COALESCE(v_note,'')),'REFUND: '),
          p_user_id
        );
      END LOOP;
    ELSE
      v_remaining := v_refund_net;
      FOR v_p IN
        SELECT *
        FROM public.payment_ledger
        WHERE store_id = p_store_id AND sale_id = p_sale_id AND is_refund = false
        ORDER BY created_at ASC
      LOOP
        EXIT WHEN v_remaining <= 0;
        IF v_p.amount_centavos <= 0 THEN CONTINUE; END IF;
        INSERT INTO public.payment_ledger(
          store_id, sale_id, customer_id, method, amount_centavos, is_refund, notes, created_by
        ) VALUES (
          p_store_id,
          p_sale_id,
          v_sale.customer_id,
          v_p.method,
          LEAST(v_p.amount_centavos, v_remaining),
          true,
          nullif(('REFUND: ' || COALESCE(v_note,'')),'REFUND: '),
          p_user_id
        );
        v_remaining := v_remaining - LEAST(v_p.amount_centavos, v_remaining);
      END LOOP;
    END IF;
  END IF;

  UPDATE public.sales
    SET status = 'refunded',
        refunded_at = now()
  WHERE store_id = p_store_id AND sale_id = p_sale_id;

  v_result := jsonb_build_object(
    'sale_id', p_sale_id,
    'status', 'refunded',
    'refund_centavos', v_refund_net
  );

  UPDATE public.idempotency_keys
    SET status = 'applied', result_json = v_result
  WHERE store_id = p_store_id AND key_type = 'refundSale' AND key = p_refund_request_id;

  RETURN jsonb_build_object('duplicate', false) || v_result;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE public.idempotency_keys
      SET status = 'failed',
          error_json = jsonb_build_object('message', SQLERRM)
    WHERE store_id = p_store_id AND key_type = 'refundSale' AND key = p_refund_request_id;
  EXCEPTION WHEN OTHERS THEN
  END;
  RAISE;
END;
$$;

commit;
