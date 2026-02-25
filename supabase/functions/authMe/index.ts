import { ok, fail, json } from "../_shared/http.ts";
import { requireAuth, listMembershipsAndStores } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, { status: 200 });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use POST", undefined, 405);

  try {
    const { user } = await requireAuth(req);
    const { memberships, stores } = await listMembershipsAndStores(user.user_id);
    return ok({ user, memberships, stores });
  } catch (e) {
    const msg = e?.message || String(e);
    const code = msg === "AUTH_REQUIRED" || msg === "AUTH_EXPIRED" ? "AUTH_REQUIRED" : "SERVER_ERROR";
    return fail(code, code === "AUTH_REQUIRED" ? "Authentication required" : msg, e, 401);
  }
});
