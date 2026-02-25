import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonFailFromError, jsonOk } from "../_shared/response.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { normalizeEmail } from "../_shared/normalize.ts";
import { verifyPassword } from "../_shared/password.ts";
import { issueSession, listMembershipsAndStores } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = supabaseService();
    const body = await req.json();

    const device_id = String(body?.device_id ?? "").trim();
    const password = String(body?.password ?? "");
    if (!device_id) return jsonFail(400, "BAD_REQUEST", "device_id required");
    if (!password) return jsonFail(400, "BAD_REQUEST", "password required");

    const { email, email_canonical } = normalizeEmail(body?.email);
    if (!email || !email.includes("@")) return jsonFail(400, "BAD_REQUEST", "Invalid email");

    const { data: user, error: uErr } = await supabase
      .from("user_accounts")
      .select("user_id,full_name,phone_number,email,email_canonical,password_hash,is_active")
      .eq("email_canonical", email_canonical)
      .maybeSingle();

    if (uErr) throw new Error(uErr.message);
    if (!user || !user.is_active) return jsonFail(401, "INVALID_CREDENTIALS", "Invalid email or password");

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return jsonFail(401, "INVALID_CREDENTIALS", "Invalid email or password");

    const { tokens } = await issueSession({ user_id: user.user_id, device_id });
    const { memberships, stores } = await listMembershipsAndStores(user.user_id);
    const next_action = memberships.length === 0 ? "create_first_store" : (stores.length > 1 ? "select_store" : "go_to_app");

    return jsonOk({
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        phone_number: user.phone_number,
        email: user.email,
      },
      session: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.access_expires_at,
      },
      next_action,
      memberships,
      stores,
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
});
