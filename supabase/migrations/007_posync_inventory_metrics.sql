-- Change Set 5: Inventory metrics RPC

CREATE OR REPLACE FUNCTION public.posync_inventory_metrics(
  p_store_id uuid,
  p_actor_user_id uuid,
  p_window_days int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  window_days int := COALESCE(p_window_days, 30);
  cutoff timestamptz;
  sold jsonb;
BEGIN
  PERFORM public.posync_require_permission(p_store_id, p_actor_user_id, 'reports_access');

  IF window_days < 1 THEN window_days := 1; END IF;
  IF window_days > 365 THEN window_days := 365; END IF;

  cutoff := now() - (window_days || ' days')::interval;

  SELECT COALESCE(jsonb_object_agg(product_id::text, sold_qty), '{}'::jsonb)
    INTO sold
  FROM (
    SELECT si.product_id,
           SUM(si.qty)::numeric(12,3) AS sold_qty
    FROM public.sale_items si
    JOIN public.sales s
      ON s.sale_id = si.sale_id
     AND s.store_id = p_store_id
     AND s.deleted_at IS NULL
     AND s.status IN ('completed','due')
     AND s.created_at >= cutoff
    WHERE si.store_id = p_store_id
    GROUP BY si.product_id
  ) t;

  RETURN jsonb_build_object(
    'window_days', window_days,
    'monthly_sold_by_product', sold
  );
END;
$$;
