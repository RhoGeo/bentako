import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth, listMembershipsAndStores } from "./_lib/auth.ts";

export async function authMe(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const { memberships, stores } = await listMembershipsAndStores(base44, user.user_id);
    return jsonOk({
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        phone_number: user.phone_number || "",
        email: user.email,
      },
      memberships,
      stores,
    });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(authMe);
