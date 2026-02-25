-- Change Set 5: DB-side permission/RPC enforcement for staff + settings mutations
-- Also adds Operating Policy acknowledgement fields.

-- 1) Schema additions
ALTER TABLE IF EXISTS public.store_memberships
  ADD COLUMN IF NOT EXISTS policy_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS policy_acknowledged_at timestamptz NULL;

-- 2) Permission resolution helpers
-- NOTE: This project uses custom auth + service-role Edge Functions.
-- These helpers enforce permissions even when RLS is bypassed.

CREATE OR REPLACE FUNCTION public.posync_role_template(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  r text := lower(coalesce(p_role, 'cashier'));
BEGIN
  IF r = 'owner' THEN
    RETURN ' {
      "financial_visibility": true,
      "reports_access": true,
      "reports_drilldowns": true,
      "inventory_create_edit": true,
      "inventory_edit_price": true,
      "inventory_adjust_stock": true,
      "transaction_void": true,
      "transaction_refund": true,
      "transaction_discount_override": true,
      "transaction_price_override": true,
      "customers_view": true,
      "customers_record_payment": true,
      "customers_export": true,
      "staff_manage": true,
      "permissions_manage": true,
      "devices_manage": true,
      "affiliate_invite": true,
      "referral_apply_code": true,
      "payouts_view": true,
      "payouts_request": true
    }'::jsonb;
  ELSIF r = 'manager' THEN
    RETURN ' {
      "financial_visibility": true,
      "reports_access": true,
      "reports_drilldowns": false,
      "inventory_create_edit": true,
      "inventory_edit_price": false,
      "inventory_adjust_stock": true,
      "transaction_void": false,
      "transaction_refund": false,
      "transaction_discount_override": false,
      "transaction_price_override": false,
      "customers_view": true,
      "customers_record_payment": true,
      "customers_export": false,
      "staff_manage": false,
      "permissions_manage": false,
      "devices_manage": false,
      "affiliate_invite": false,
      "referral_apply_code": false,
      "payouts_view": true,
      "payouts_request": false
    }'::jsonb;
  ELSE
    RETURN ' {
      "financial_visibility": false,
      "reports_access": false,
      "reports_drilldowns": false,
      "inventory_create_edit": false,
      "inventory_edit_price": false,
      "inventory_adjust_stock": false,
      "transaction_void": false,
      "transaction_refund": false,
      "transaction_discount_override": false,
      "transaction_price_override": false,
      "customers_view": true,
      "customers_record_payment": false,
      "customers_export": false,
      "staff_manage": false,
      "permissions_manage": false,
      "devices_manage": false,
      "affiliate_invite": false,
      "referral_apply_code": false,
      "payouts_view": false,
      "payouts_request": false
    }'::jsonb;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_resolve_permissions(p_store_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  s record;
  base jsonb;
  store_override jsonb := '{}'::jsonb;
  pset jsonb := '{}'::jsonb;
  member_override jsonb := '{}'::jsonb;
BEGIN
  SELECT store_membership_id, role, permission_set_id, overrides_json, is_active
    INTO m
  FROM public.store_memberships
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  LIMIT 1;

  IF m.store_membership_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT store_settings_json, deleted_at
    INTO s
  FROM public.stores
  WHERE store_id = p_store_id
  LIMIT 1;

  IF s.deleted_at IS NOT NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  base := public.posync_role_template(m.role::text);

  -- Store-level role overrides live inside store_settings_json.
  IF lower(m.role::text) = 'manager' THEN
    store_override := COALESCE(s.store_settings_json -> 'role_permissions_manager_json', '{}'::jsonb);
  ELSIF lower(m.role::text) = 'cashier' THEN
    store_override := COALESCE(s.store_settings_json -> 'role_permissions_cashier_json', '{}'::jsonb);
  END IF;

  IF m.permission_set_id IS NOT NULL THEN
    SELECT COALESCE(permissions_json, '{}'::jsonb) INTO pset
    FROM public.permission_sets
    WHERE permission_set_id = m.permission_set_id
    LIMIT 1;
  END IF;

  member_override := COALESCE(m.overrides_json, '{}'::jsonb);

  RETURN base || store_override || pset || member_override;
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_can(p_store_id uuid, p_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  perms jsonb;
  v text := coalesce(p_permission, '');
BEGIN
  IF v = '' THEN
    RETURN false;
  END IF;

  perms := public.posync_resolve_permissions(p_store_id, p_user_id);
  RETURN COALESCE((perms ->> v)::boolean, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_require_permission(p_store_id uuid, p_user_id uuid, p_permission text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.posync_can(p_store_id, p_user_id, p_permission) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_require_owner(p_store_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.store_role;
BEGIN
  SELECT role INTO r
  FROM public.store_memberships
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  LIMIT 1;

  IF r IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF r <> 'owner' THEN
    RAISE EXCEPTION 'Owner only' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- 3) Settings RPCs
CREATE OR REPLACE FUNCTION public.posync_update_store_settings(
  p_store_id uuid,
  p_actor_user_id uuid,
  p_store_name text,
  p_allow_negative_stock boolean,
  p_low_stock_threshold_default int,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_keys text[] := ARRAY[
    'address','contact',
    'pin_required_void_refund','pin_required_discount_override','pin_required_price_override','pin_required_price_discount_override',
    'pin_required_stock_adjust','pin_required_export','pin_required_device_revoke',
    'auto_sync_on_reconnect','auto_sync_after_event'
  ];
  current_settings jsonb;
  filtered_patch jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  updated record;
BEGIN
  PERFORM public.posync_require_owner(p_store_id, p_actor_user_id);

  SELECT store_settings_json INTO current_settings
  FROM public.stores
  WHERE store_id = p_store_id AND deleted_at IS NULL
  FOR UPDATE;

  IF current_settings IS NULL THEN
    RAISE EXCEPTION 'Store not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_patch IS NOT NULL AND jsonb_typeof(p_patch) = 'object' THEN
    FOR k IN SELECT jsonb_object_keys(p_patch)
    LOOP
      IF k = ANY(allowed_keys) THEN
        v := p_patch -> k;
        filtered_patch := filtered_patch || jsonb_build_object(k, v);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.stores
    SET store_settings_json = COALESCE(current_settings, '{}'::jsonb) || filtered_patch,
        store_name = CASE WHEN p_store_name IS NULL OR length(trim(p_store_name)) < 2 THEN store_name ELSE trim(p_store_name) END,
        allow_negative_stock = COALESCE(p_allow_negative_stock, allow_negative_stock),
        low_stock_threshold_default = CASE WHEN p_low_stock_threshold_default IS NULL OR p_low_stock_threshold_default < 0 THEN low_stock_threshold_default ELSE p_low_stock_threshold_default END
  WHERE store_id = p_store_id AND deleted_at IS NULL
  RETURNING store_id, store_name, store_settings_json, allow_negative_stock, low_stock_threshold_default, owner_pin_hash
  INTO updated;

  RETURN jsonb_build_object(
    'store_name', updated.store_name,
    'allow_negative_stock', updated.allow_negative_stock,
    'low_stock_threshold_default', updated.low_stock_threshold_default
  ) || COALESCE(updated.store_settings_json, '{}'::jsonb) || jsonb_build_object('owner_pin_hash', updated.owner_pin_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_set_owner_pin(
  p_store_id uuid,
  p_actor_user_id uuid,
  p_owner_pin_hash text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.posync_require_owner(p_store_id, p_actor_user_id);

  UPDATE public.stores
    SET owner_pin_hash = NULLIF(trim(coalesce(p_owner_pin_hash,'')), '')
  WHERE store_id = p_store_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_update_store_permissions(
  p_store_id uuid,
  p_actor_user_id uuid,
  p_role_permissions_manager_json jsonb,
  p_role_permissions_cashier_json jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur jsonb;
  merged jsonb;
BEGIN
  PERFORM public.posync_require_permission(p_store_id, p_actor_user_id, 'permissions_manage');

  IF (p_role_permissions_manager_json IS NULL OR jsonb_typeof(p_role_permissions_manager_json) <> 'object')
     AND (p_role_permissions_cashier_json IS NULL OR jsonb_typeof(p_role_permissions_cashier_json) <> 'object') THEN
    RAISE EXCEPTION 'No permissions payload provided' USING ERRCODE = '22023';
  END IF;

  SELECT store_settings_json INTO cur
  FROM public.stores
  WHERE store_id = p_store_id AND deleted_at IS NULL
  FOR UPDATE;

  IF cur IS NULL THEN
    RAISE EXCEPTION 'Store not found' USING ERRCODE = 'P0002';
  END IF;

  merged := COALESCE(cur, '{}'::jsonb);
  IF p_role_permissions_manager_json IS NOT NULL AND jsonb_typeof(p_role_permissions_manager_json) = 'object' THEN
    merged := merged || jsonb_build_object('role_permissions_manager_json', p_role_permissions_manager_json);
  END IF;
  IF p_role_permissions_cashier_json IS NOT NULL AND jsonb_typeof(p_role_permissions_cashier_json) = 'object' THEN
    merged := merged || jsonb_build_object('role_permissions_cashier_json', p_role_permissions_cashier_json);
  END IF;

  UPDATE public.stores
    SET store_settings_json = merged
  WHERE store_id = p_store_id AND deleted_at IS NULL;
END;
$$;

-- 4) Staff RPCs
CREATE OR REPLACE FUNCTION public.posync_add_staff_by_email(
  p_store_id uuid,
  p_actor_user_id uuid,
  p_user_email text,
  p_role public.store_role
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id uuid;
  canon citext;
BEGIN
  PERFORM public.posync_require_permission(p_store_id, p_actor_user_id, 'staff_manage');

  canon := lower(trim(coalesce(p_user_email,'')))::citext;
  IF canon IS NULL OR position('@' in canon::text) = 0 THEN
    RAISE EXCEPTION 'Valid user_email required' USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO target_user_id
  FROM public.user_accounts
  WHERE email_canonical = canon
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.store_memberships(store_id, user_id, role, is_active, created_by)
  VALUES (p_store_id, target_user_id, COALESCE(p_role,'cashier'), true, p_actor_user_id)
  ON CONFLICT (store_id, user_id)
  DO UPDATE SET role = EXCLUDED.role,
                is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_update_store_member(
  p_store_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_role public.store_role,
  p_is_active boolean,
  p_overrides jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tgt record;
  next_role public.store_role;
  next_active boolean;
  will_remove_owner boolean := false;
  other_owner_count int;
BEGIN
  PERFORM public.posync_require_permission(p_store_id, p_actor_user_id, 'staff_manage');

  SELECT store_membership_id, store_id, user_id, role, is_active
    INTO tgt
  FROM public.store_memberships
  WHERE store_membership_id = p_membership_id
  LIMIT 1;

  IF tgt.store_membership_id IS NULL OR tgt.store_id <> p_store_id THEN
    RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002';
  END IF;

  next_role := COALESCE(p_role, tgt.role);
  next_active := COALESCE(p_is_active, tgt.is_active);

  will_remove_owner := (tgt.role = 'owner' AND (next_active = false OR next_role <> 'owner'));

  IF will_remove_owner THEN
    SELECT count(*) INTO other_owner_count
    FROM public.store_memberships
    WHERE store_id = p_store_id AND is_active = true AND role = 'owner'
      AND store_membership_id <> tgt.store_membership_id;

    IF COALESCE(other_owner_count,0) <= 0 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of a store.' USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.store_memberships
    SET role = next_role,
        is_active = next_active,
        overrides_json = COALESCE(p_overrides, overrides_json)
  WHERE store_membership_id = tgt.store_membership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.posync_assign_staff_to_stores(
  p_actor_user_id uuid,
  p_user_email text,
  p_store_ids uuid[],
  p_role public.store_role
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id uuid;
  sid uuid;
  canon citext;
  actor_role public.store_role;
BEGIN
  canon := lower(trim(coalesce(p_user_email,'')))::citext;
  IF canon IS NULL OR position('@' in canon::text) = 0 THEN
    RAISE EXCEPTION 'Valid user_email required' USING ERRCODE = '22023';
  END IF;

  IF p_store_ids IS NULL OR array_length(p_store_ids,1) IS NULL OR array_length(p_store_ids,1) = 0 THEN
    RAISE EXCEPTION 'store_ids required' USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO target_user_id
  FROM public.user_accounts
  WHERE email_canonical = canon
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  FOREACH sid IN ARRAY p_store_ids
  LOOP
    SELECT role INTO actor_role
    FROM public.store_memberships
    WHERE store_id = sid AND user_id = p_actor_user_id AND is_active = true
    LIMIT 1;

    IF actor_role IS NULL OR actor_role <> 'owner' THEN
      RAISE EXCEPTION 'Owner only for multi-store assignment' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.store_memberships(store_id, user_id, role, is_active, created_by)
    VALUES (sid, target_user_id, COALESCE(p_role,'cashier'), true, p_actor_user_id)
    ON CONFLICT (store_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, is_active = true;
  END LOOP;
END;
$$;

-- 5) Operating Policy acknowledgement
CREATE OR REPLACE FUNCTION public.posync_acknowledge_policy(
  p_store_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.store_memberships
    SET policy_acknowledged = true,
        policy_acknowledged_at = now()
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
