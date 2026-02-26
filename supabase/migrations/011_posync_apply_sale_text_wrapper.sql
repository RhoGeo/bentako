-- POSync Step 11: Compatibility wrapper for applying sales via text payload
--
-- Some HTTP/RPC client stacks can accidentally send JSONB args as text.
-- This wrapper ensures we can always apply a sale by sending a JSON string
-- and casting inside Postgres.
--
-- Usage:
--   select public.posync_apply_sale_text(p_store_id, p_user_id, p_device_id, p_client_tx_id, p_sale_text);
--
begin;

create or replace function public.posync_apply_sale_text(
  p_store_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_client_tx_id text,
  p_sale_text text
)
returns jsonb
language plpgsql
as $$
begin
  if p_sale_text is null or length(trim(p_sale_text)) = 0 then
    raise exception 'sale_text required' using errcode = '22023';
  end if;

  return public.posync_apply_sale(
    p_store_id,
    p_user_id,
    p_device_id,
    p_client_tx_id,
    p_sale_text::jsonb
  );
end;
$$;

commit;
