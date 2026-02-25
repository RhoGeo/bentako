import { requireAuth } from "../_shared/auth.ts";
import { supabaseService } from "../_shared/supabase.ts";
import { requireStorePermission } from "../_shared/storeAccess.ts";
import { mapErrorToResponse } from "../_shared/errors.ts";
import { jsonFail, jsonOk } from "../_shared/response.ts";
import { corsHeaders } from "../_shared/cors.ts";

function str(v: unknown) {
  return String(v ?? "").trim();
}

async function countActiveOwners(supabase: any, store_id: string): Promise<number> {
  const { count, error } = await supabase
    .from("store_memberships")
    .select("store_membership_id", { count: "exact", head: true })
    .eq("store_id", store_id)
    .eq("is_active", true)
    .eq("role", "owner");
  if (error) throw new Error(error.message);
  return Number(count || 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await requireAuth(req);
    const supabase = supabaseService();
    const body = await req.json();

    const store_id = str(body?.store_id);
    const membership_id = str(body?.membership_id);
    if (!store_id) return jsonFail(400, "BAD_REQUEST", "store_id required");
    if (!membership_id) return jsonFail(400, "BAD_REQUEST", "membership_id required");

    await requireStorePermission({ user_id: user.user_id, store_id, permission: "staff_manage" });

    const { data: target, error: terr } = await supabase
      .from("store_memberships")
      .select("store_membership_id,store_id,user_id,role,is_active,overrides_json")
      .eq("store_membership_id", membership_id)
      .maybeSingle();
    if (terr) throw new Error(terr.message);
    if (!target || target.store_id !== store_id) return jsonFail(404, "NOT_FOUND", "Membership not found");

    const nextRole = body?.role != null ? str(body.role) : null;
    const nextActive = body?.is_active != null ? !!body.is_active : null;
    const nextOverrides = body?.overrides_json != null ? body.overrides_json : null;

    // Safety: never allow removing the last owner.
    const willDeactivateOwner =
      (target.role === "owner" && nextActive === false) ||
      (target.role === "owner" && nextRole != null && nextRole !== "owner");

    if (willDeactivateOwner) {
      const ownerCount = await countActiveOwners(supabase, store_id);
      if (ownerCount <= 1) {
        return jsonFail(409, "LAST_OWNER", "Cannot remove the last owner of a store.");
      }
    }

    const update: Record<string, any> = {};
    if (nextRole !== null) update.role = nextRole;
    if (nextActive !== null) update.is_active = nextActive;
    if (nextOverrides !== null) update.overrides_json = nextOverrides;

    if (Object.keys(update).length === 0) return jsonOk({ ok: true });

    const { error: uerr } = await supabase
      .from("store_memberships")
      .update(update)
      .eq("store_membership_id", membership_id);
    if (uerr) throw new Error(uerr.message);

    return jsonOk({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
});
