import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function emailCanon(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}
function str(v: unknown) {
  return String(v ?? "").trim();
}

function randomToken(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();

    const store_id = str(body?.store_id);
    const invite_email = emailCanon(body?.invite_email);
    const role = str(body?.role || "cashier") || "cashier";

    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!invite_email || !invite_email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Valid invite_email required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "staff_manage" });

    const code = randomToken(18);
    const expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const { data, error } = await supabase
      .from("invitation_codes")
      .insert({
        code,
        type: "staff_invite",
        store_id,
        role,
        invite_email,
        max_uses: 1,
        used_count: 0,
        expires_at,
        created_by: user.user_id,
      })
      .select("invitation_code_id,code,invite_email,role,expires_at")
      .single();
    if (error) throw new Error(error.message);

    return jsonOk({ invite_token: data.code, invite_id: data.invitation_code_id, expires_at: data.expires_at });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
