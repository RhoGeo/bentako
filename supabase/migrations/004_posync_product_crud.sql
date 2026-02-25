-- POSync Change Set 2: Product/Variant CRUD (transactional) + category upsert

create or replace function public.posync_upsert_product(
  p_store_id uuid,
  p_user_id uuid,
  p_product_id uuid,
  p_is_parent boolean,
  p_name text,
  p_category_name text,
  p_barcode text,
  p_price_centavos int,
  p_cost_price_centavos int,
  p_track_stock boolean,
  p_stock_quantity int,
  p_low_stock_threshold int,
  p_variants jsonb
) returns uuid
language plpgsql
as $$
declare
  v_category_id uuid;
  v_parent_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_name text;
  v_barcode text;
  v_price int;
  v_cost int;
  v_track boolean;
  v_stock int;
  v_low int;
begin
  if p_store_id is null then
    raise exception 'store_id required';
  end if;
  if p_user_id is null then
    raise exception 'user_id required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required';
  end if;

  -- Category: case-insensitive upsert by name within store.
  if p_category_name is not null and btrim(p_category_name) <> '' then
    select category_id
      into v_category_id
    from public.categories
    where store_id = p_store_id
      and deleted_at is null
      and lower(name) = lower(btrim(p_category_name))
    order by created_at asc
    limit 1;

    if v_category_id is null then
      insert into public.categories (store_id, name, created_by)
      values (p_store_id, btrim(p_category_name), p_user_id)
      returning category_id into v_category_id;
    end if;
  end if;

  if p_is_parent then
    -- Parent product
    if p_product_id is null then
      insert into public.products (
        store_id, is_parent, parent_product_id, category_id,
        name, barcode, price_centavos, cost_price_centavos,
        track_stock, stock_quantity, low_stock_threshold,
        created_by, is_active
      ) values (
        p_store_id, true, null, v_category_id,
        btrim(p_name), null, null, null,
        false, 0, nullif(coalesce(p_low_stock_threshold, 0), 0),
        p_user_id, true
      ) returning product_id into v_parent_id;
    else
      update public.products
      set category_id = v_category_id,
          name = btrim(p_name),
          is_parent = true,
          parent_product_id = null,
          barcode = null,
          price_centavos = null,
          cost_price_centavos = null,
          track_stock = false,
          stock_quantity = 0,
          low_stock_threshold = nullif(coalesce(p_low_stock_threshold, 0), 0),
          is_active = true,
          deleted_at = null
      where store_id = p_store_id
        and product_id = p_product_id;

      if not found then
        raise exception 'Product not found';
      end if;
      v_parent_id := p_product_id;
    end if;

    -- Variants required
    if p_variants is null
       or jsonb_typeof(p_variants) <> 'array'
       or jsonb_array_length(p_variants) = 0 then
      raise exception 'At least 1 variant is required';
    end if;

    for v_variant in select * from jsonb_array_elements(p_variants)
    loop
      v_variant_id := nullif(coalesce(v_variant->>'id',''), '')::uuid;
      v_name := btrim(coalesce(v_variant->>'name',''));
      if v_name = '' then
        raise exception 'Variant name is required';
      end if;

      v_cost := coalesce((v_variant->>'cost_price_centavos')::int, 0);
      if v_cost <= 0 then
        raise exception 'Variant cost price is required';
      end if;

      v_price := coalesce((v_variant->>'price_centavos')::int, 0);
      if v_price < 0 then
        raise exception 'Variant price must be >= 0';
      end if;

      v_barcode := btrim(coalesce(v_variant->>'barcode',''));
      if v_barcode = '' then v_barcode := null; end if;

      v_track := coalesce((v_variant->>'track_stock')::boolean, false);
      v_stock := coalesce((v_variant->>'stock_quantity')::int, 0);
      if not v_track then v_stock := 0; end if;

      v_low := nullif(coalesce((v_variant->>'low_stock_threshold')::int, 0), 0);

      if v_variant_id is null then
        insert into public.products (
          store_id, is_parent, parent_product_id, category_id,
          name, barcode, price_centavos, cost_price_centavos,
          track_stock, stock_quantity, low_stock_threshold,
          created_by, is_active
        ) values (
          p_store_id, false, v_parent_id, v_category_id,
          v_name, v_barcode, v_price, v_cost,
          v_track, v_stock, v_low,
          p_user_id, true
        ) returning product_id into v_variant_id;
      else
        update public.products
        set is_parent = false,
            parent_product_id = v_parent_id,
            category_id = v_category_id,
            name = v_name,
            barcode = v_barcode,
            price_centavos = v_price,
            cost_price_centavos = v_cost,
            track_stock = v_track,
            stock_quantity = v_stock,
            low_stock_threshold = v_low,
            is_active = true,
            deleted_at = null
        where store_id = p_store_id
          and product_id = v_variant_id;

        if not found then
          raise exception 'Variant not found';
        end if;
      end if;

      v_keep_ids := array_append(v_keep_ids, v_variant_id);
    end loop;

    -- Deactivate removed variants
    update public.products
    set is_active = false
    where store_id = p_store_id
      and parent_product_id = v_parent_id
      and is_parent = false
      and (product_id <> all(v_keep_ids));

    return v_parent_id;

  else
    -- Single product
    if p_cost_price_centavos is null or p_cost_price_centavos <= 0 then
      raise exception 'Cost price is required';
    end if;
    if p_price_centavos is null then
      p_price_centavos := 0;
    end if;
    if p_price_centavos < 0 then
      raise exception 'Price must be >= 0';
    end if;

    v_barcode := btrim(coalesce(p_barcode, ''));
    if v_barcode = '' then v_barcode := null; end if;

    v_stock := coalesce(p_stock_quantity, 0);
    v_track := coalesce(p_track_stock, true);
    if not v_track then v_stock := 0; end if;

    v_low := nullif(coalesce(p_low_stock_threshold, 0), 0);

    if p_product_id is null then
      insert into public.products (
        store_id, is_parent, parent_product_id, category_id,
        name, barcode, price_centavos, cost_price_centavos,
        track_stock, stock_quantity, low_stock_threshold,
        created_by, is_active
      ) values (
        p_store_id, false, null, v_category_id,
        btrim(p_name), v_barcode, p_price_centavos, p_cost_price_centavos,
        v_track, v_stock, v_low,
        p_user_id, true
      ) returning product_id into v_parent_id;

      return v_parent_id;
    else
      update public.products
      set category_id = v_category_id,
          name = btrim(p_name),
          barcode = v_barcode,
          price_centavos = p_price_centavos,
          cost_price_centavos = p_cost_price_centavos,
          track_stock = v_track,
          stock_quantity = v_stock,
          low_stock_threshold = v_low,
          is_parent = false,
          parent_product_id = null,
          is_active = true,
          deleted_at = null
      where store_id = p_store_id
        and product_id = p_product_id;

      if not found then
        raise exception 'Product not found';
      end if;

      return p_product_id;
    end if;
  end if;
end;
$$;
