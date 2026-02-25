import { supabaseService } from "./supabase.ts";

export async function requireStoreAccess(args: { user_id: string; store_id: string }) {
  const supabase = supabaseService();
  const { data, error } = await supabase
    .from("store_memberships")
    .select("store_membership_id,role,is_active")
    .eq("store_id", args.store_id)
    .eq("user_id", args.user_id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Store access check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: not a store member");
  return data;
}
