import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import { customerRowToSnapshot, type DbCustomerRow } from "../_shared/snapshots.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

function toCentavos(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return c >= 0 ? c : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const { user } = await requireAuth(req);

    const body = await req.json();
    const store_id = str(body?.store_id);
    const customer = body?.customer ?? {};

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireStoreAccess({ user_id: user.user_id, store_id });

    const name = str(customer?.name);
    if (!name) return jsonFail(400, "BAD_REQUEST", "Customer name is required");

    const phone = str(customer?.phone) || null;
    const address = str(customer?.address) || null;
    const allow_utang = customer?.allow_utang === false ? false : true;
    const credit_limit_centavos =
      customer?.credit_limit_centavos != null
        ? Number(customer.credit_limit_centavos)
        : toCentavos(customer?.credit_limit_peso);

    const notes = str(customer?.notes) || null;

    const { data: row, error } = await supabase
      .from("customers")
      .insert({
        store_id,
        name,
        phone,
        address,
        allow_utang,
        credit_limit_centavos,
        notes,
        created_by: user.user_id,
      })
      .select(
        "customer_id,store_id,name,phone,address,allow_utang,credit_limit_centavos,balance_due_centavos,notes,last_transaction_date,created_at,updated_at,deleted_at"
      )
      .single();

    if (error) throw new Error(error.message);

    return jsonOk({ customer: customerRowToSnapshot(row as any as DbCustomerRow) });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
