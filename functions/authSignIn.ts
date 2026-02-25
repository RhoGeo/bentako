import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { normalizeEmail } from "./_lib/authNormalization.ts";
import { verifyPassword } from "./_lib/passwordHashing.ts";
import { assertRequiredEntitiesExist } from "./_lib/schemaVerify.ts";
import { issueSession, listMembershipsAndStores } from "./_lib/auth.ts";

export async function authSignIn(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    assertRequiredEntitiesExist(base44, [
      "UserAccount",
      "AuthSession",
      "StoreMembership",
    ]);

    const body = await req.json();
    const { email, email_canonical } = normalizeEmail(body?.email);
    const password = String(body?.password || "");
    const device_id = String(body?.device_id || "").trim();

    if (!email || !password || !device_id) {
      return jsonFail(400, "BAD_REQUEST", "email, password, device_id required");
    }

    const users = await base44.asServiceRole.entities.UserAccount.filter({ email_canonical });
    const u = users?.[0];
    if (!u || u.is_active === false) {
      throw Object.assign(new Error("Invalid credentials"), { code: "INVALID_CREDENTIALS" });
    }

    const ok = await verifyPassword(password, String(u.password_hash || ""));
    if (!ok) {
      throw Object.assign(new Error("Invalid credentials"), { code: "INVALID_CREDENTIALS" });
    }

    const user_id = String(u.user_id);
    const { tokens } = await issueSession(base44, { user_id, device_id });
    const { memberships, stores } = await listMembershipsAndStores(base44, user_id);

    let next_action: "create_first_store" | "select_store" | "go_to_app";
    if (memberships.length === 0) next_action = "create_first_store";
    else if (memberships.length > 1) next_action = "select_store";
    else next_action = "go_to_app";

    return jsonOk({
      user: {
        user_id,
        full_name: u.full_name,
        phone_number: u.phone_number,
        email: u.email || email,
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
}

Deno.serve(authSignIn);
