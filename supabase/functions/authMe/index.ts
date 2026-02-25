import { corsHeaders } from "../_shared/cors.ts";
import { jsonFail, jsonFailFromError, jsonOk } from "../_shared/response.ts";
import { requireAuth, listMembershipsAndStores } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { user } = await requireAuth(req);
    const { memberships, stores } = await listMembershipsAndStores(user.user_id);

    return jsonOk({
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        phone_number: user.phone_number,
        email: user.email,
      },
      memberships,
      stores,
    });
  } catch (err) {
    // Make auth errors 401 for better UX
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("missing")) {
      return jsonFail(401, "UNAUTHORIZED", msg);
    }
    return jsonFailFromError(err);
  }
});
