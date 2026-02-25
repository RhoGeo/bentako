import { supabaseService } from "./supabase.ts";
import { canPermission, type PermissionKey } from "./permissions.ts";

export async function requireStoreAccess(args: { user_id: string; store_id: string }) {
  const supabase = supabaseService();
  const { data, error } = await supabase
    .from("store_memberships")
    .select("store_membership_id,store_id,user_id,role,permission_set_id,overrides_json,is_active")
    .eq("store_id", args.store_id)
    .eq("user_id", args.user_id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Store access check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: not a store member");
  return data;
}

export async function requireStorePermission(args: { user_id: string; store_id: string; permission: PermissionKey }) {
  const supabase = supabaseService();
  const membership = await requireStoreAccess({ user_id: args.user_id, store_id: args.store_id });

  const { data: store, error: serr } = await supabase
    .from("stores")
    .select("store_id,store_settings_json,deleted_at")
    .eq("store_id", args.store_id)
    .maybeSingle();
  if (serr) throw new Error(`Store settings lookup failed: ${serr.message}`);
  if (!store || store.deleted_at) throw new Error("Store not found");

  const allowed = canPermission(
    { role: membership.role, overrides_json: membership.overrides_json, store_settings_json: store.store_settings_json },
    args.permission,
  );
  if (!allowed) throw new Error(`Forbidden: missing permission ${args.permission}`);
  return { membership, store };
}
