import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { requireAuth } from "./_lib/auth.ts";
import { assertRequiredEntitiesExist } from "./_lib/schemaVerify.ts";

export async function createFirstStore(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    assertRequiredEntitiesExist(base44, ["Store", "StoreMembership"]);

    const { user } = await requireAuth(base44, req);
    const body = await req.json();
    const store_name = String(body?.store_name || "").trim();
    const device_id = String(body?.device_id || "").trim();
    if (!store_name || !device_id) {
      return jsonFail(400, "BAD_REQUEST", "store_name and device_id required");
    }

    const existingMemberships = await base44.asServiceRole.entities.StoreMembership.filter({ user_id: user.user_id, is_active: true });
    if (existingMemberships?.length) {
      return jsonFail(400, "ALREADY_HAS_STORE", "User already has a store membership");
    }

    const now = new Date().toISOString();
    const store = await base44.asServiceRole.entities.Store.create({
      store_name,
      owner_user_id: user.user_id,
      low_stock_threshold_default: 5,
      allow_negative_stock: false,
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
    });

    const membership = await base44.asServiceRole.entities.StoreMembership.create({
      store_id: store.id,
      user_id: user.user_id,
      user_email: user.email,
      user_name: user.full_name,
      role: "owner",
      overrides_json: {},
      is_active: true,
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
    });

    // Back-compat: ensure StaffMember exists (best-effort).
    try {
      await base44.asServiceRole.entities.StaffMember.create({
        store_id: store.id,
        user_email: user.email,
        user_name: user.full_name,
        role: "owner",
        overrides_json: {},
        is_active: true,
        created_at: now,
      });
    } catch (_e) {}

    // Best-effort: record device session
    try {
      await base44.asServiceRole.entities.Device.create({
        store_id: store.id,
        device_id,
        user_id: user.user_id,
        name: "",
        last_seen_at: now,
        allowed: true,
        created_by: user.user_id,
        created_at: now,
        updated_at: now,
      });
    } catch (_e) {}

    return jsonOk({ store, membership });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(createFirstStore);
