import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStoreAccess } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function emailCanon(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}
function str(v: unknown) {
  return String(v ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();

    const store_ids = Array.isArray(body?.store_ids) ? body.store_ids.map(str).filter(Boolean) : [];
    const user_email = emailCanon(body?.user_email);
    const role = str(body?.role || "cashier") || "cashier";

    if (!user_email || !user_email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Valid user_email required");
    if (store_ids.length === 0) return jsonFail(400, "BAD_REQUEST", "store_ids required");

    const { data: users, error: uerr } = await supabase
      .from("user_accounts")
      .select("user_id")
      .eq("email_canonical", user_email)
      .limit(1);
    if (uerr) throw new Error(uerr.message);
    const target = users?.[0];
    if (!target) return jsonFail(404, "USER_NOT_FOUND", "User not found. They must sign up first.");

    for (const store_id of store_ids) {
      const m = await requireStoreAccess({ user_id: user.user_id, store_id });
      if (m.role !== "owner") return jsonFail(403, "FORBIDDEN", "Owner only for multi-store assignment");

      const { data: existing, error: exErr } = await supabase
        .from("store_memberships")
        .select("store_membership_id")
        .eq("store_id", store_id)
        .eq("user_id", target.user_id)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);

      if (existing?.store_membership_id) {
        const { error: updErr } = await supabase
          .from("store_memberships")
          .update({ role, is_active: true })
          .eq("store_membership_id", existing.store_membership_id);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await supabase.from("store_memberships").insert({
          store_id,
          user_id: target.user_id,
          role,
          is_active: true,
          created_by: user.user_id,
        });
        if (insErr) throw new Error(insErr.message);
      }
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
