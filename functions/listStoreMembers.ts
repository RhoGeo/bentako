import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { requireActiveStaff } from "./_lib/staff.ts";

/**
 * listStoreMembers — Step 11
 * Returns active StoreMembership records for a store.
 * Read-only for any store member; write actions are gated elsewhere.
 */
export async function listStoreMembers(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const { store_id } = body || {};
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");

    await requireActiveStaff(base44, store_id, user.email, user.role, user.full_name);

    const rows = await base44.asServiceRole.entities.StoreMembership.filter({ store_id, is_active: true });
    return jsonOk({ members: rows || [] });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(listStoreMembers);
