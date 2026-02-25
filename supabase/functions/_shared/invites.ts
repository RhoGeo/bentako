import { supabaseService } from "./supabase.ts";
import { normalizeInvitationCode } from "./normalize.ts";

export type InvitationApplied = { type: "affiliate_referral" | "staff_invite" };

export async function validateInvitationCode(codeInput: unknown) {
  const supabase = supabaseService();
  const code = normalizeInvitationCode(codeInput);
  if (!code) throw new Error("Invalid invitation code");

  const { data: inv, error } = await supabase
    .from("invitation_codes")
    .select("invitation_code_id,code,type,store_id,role,permission_set_id,affiliate_profile_id,max_uses,used_count,expires_at")
    .eq("code", code)
    .maybeSingle();

  if (error) throw new Error(`Invite lookup failed: ${error.message}`);
  if (!inv) throw new Error("Invitation code not found");
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) throw new Error("Invitation code expired");
  if (inv.used_count >= inv.max_uses) throw new Error("Invitation code already used");

  // Staff invite requires store_id
  if (inv.type === "staff_invite" && !inv.store_id) throw new Error("Invalid staff invite code");
  // Affiliate referral requires affiliate_profile_id
  if (inv.type === "affiliate_referral" && !inv.affiliate_profile_id) throw new Error("Invalid affiliate referral code");

  return inv;
}

export async function recordInvitationUse(args: { invitation_code_id: string; used_by_user_id: string; metadata_json?: any }) {
  const supabase = supabaseService();
  const { error: insErr } = await supabase.from("invitation_code_uses").insert({
    invitation_code_id: args.invitation_code_id,
    used_by_user_id: args.used_by_user_id,
    metadata_json: args.metadata_json ?? null,
  });
  if (insErr) throw new Error(`Failed to record invitation use: ${insErr.message}`);

  // increment used_count atomically
  const { error: incErr } = await supabase
    .from("invitation_codes")
    .update({})
    .eq("invitation_code_id", args.invitation_code_id)
    .lt("used_count", 10_000_000) // guard
    // @ts-ignore supabase-js supports increment
    .increment("used_count", 1);

  if (incErr) throw new Error(`Failed to increment invitation use: ${incErr.message}`);
}

export async function applyInvitationEffects(args: { invitation: any; new_user: { user_id: string; email: string; full_name: string } }): Promise<InvitationApplied> {
  const supabase = supabaseService();
  const inv = args.invitation;

  if (inv.type === "staff_invite") {
    const role = inv.role ?? "cashier";
    const { error } = await supabase.from("store_memberships").upsert({
      store_id: inv.store_id,
      user_id: args.new_user.user_id,
      role,
      permission_set_id: inv.permission_set_id ?? null,
      is_active: true,
      created_by: args.new_user.user_id,
    }, { onConflict: "store_id,user_id" });

    if (error) throw new Error(`Failed to create membership from invite: ${error.message}`);
    return { type: "staff_invite" };
  }

  // affiliate_referral
  const { error } = await supabase.from("referral_attributions").insert({
    affiliate_profile_id: inv.affiliate_profile_id,
    referred_user_id: args.new_user.user_id,
    invitation_code_id: inv.invitation_code_id,
  });
  if (error) throw new Error(`Failed to create referral attribution: ${error.message}`);
  return { type: "affiliate_referral" };
}
