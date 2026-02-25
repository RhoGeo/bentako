import React, { useState } from "react";
import { ArrowLeft, Gift, Copy, Lock, Check, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { can, guard } from "@/components/lib/permissions";
import { auditLog } from "@/components/lib/auditLog";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActiveStoreId } from "@/components/lib/activeStore";

export default function Affiliate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { staffMember, user } = useCurrentStaff(storeId);
  const { settings, rawSettings, isUsingSafeDefaults } = useStoreSettings(storeId);
  const canApply = can(staffMember, "referral_apply_code");
  const canInvite = can(staffMember, "affiliate_invite");

  const [applyCode, setApplyCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const alreadyApplied = !!settings.referral_code_applied;

  const handleApplyCode = async () => {
    const { allowed, reason } = guard(staffMember, "referral_apply_code");
    if (!allowed) { toast.error(reason); return; }
    if (!applyCode.trim()) { toast.error("Enter a referral code."); return; }
    if (alreadyApplied) { toast.error("Referral code already applied. Applied once only."); return; }

    setApplying(true);
    // Server enforces apply-once
    await base44.functions.invoke("applyReferralCode", { store_id: storeId, referral_code: applyCode.trim() });
    await auditLog("referral_code_applied", `Referral code applied: ${applyCode.slice(0, 4)}****`, {
      actor_email: user?.email,
      metadata: { code_prefix: applyCode.slice(0, 4) },
    });
    queryClient.invalidateQueries({ queryKey: ["store-settings", storeId] });
    toast.success("Referral code applied! 10% discount forever.");
    setApplying(false);
    setApplyCode("");
  };

  const handleInvite = async () => {
    const { allowed, reason } = guard(staffMember, "affiliate_invite");
    if (!allowed) { toast.error(reason); return; }
    if (!inviteEmail.trim()) { toast.error("Enter an email."); return; }
    setInviting(true);
    await auditLog("affiliate_invite_sent", `Affiliate invitation sent to ${inviteEmail}`, { actor_email: user?.email, metadata: { invited_email: inviteEmail } });
    toast.success(`Invitation sent to ${inviteEmail}!`);
    setInviteEmail("");
    setInviting(false);
  };

  // Our store's own referral code (derived from store ID for demo)
  const myReferralCode = `POSYNC-${(rawSettings?.id || "DEMO").slice(-6).toUpperCase()}`;

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800">Affiliate / Referral</h1>
      </div>

      <div className="px-4 py-5 space-y-5">
        {/* My referral code */}
        <section className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-5 border border-amber-100">
          <p className="text-xs font-semibold text-amber-700 uppercase mb-2">Your Referral Code</p>
          <div className="flex items-center gap-2 bg-white rounded-xl px-4 py-3 border border-amber-200">
            <p className="font-mono font-bold text-xl text-stone-800 flex-1 tracking-widest">{myReferralCode}</p>
            <button onClick={() => { navigator.clipboard.writeText(myReferralCode); toast.success("Code copied!"); }}>
              <Copy className="w-5 h-5 text-amber-600" />
            </button>
          </div>
          <p className="text-xs text-amber-600 mt-2">Share this code to earn referral rewards.</p>
        </section>

        {/* Apply a referral code */}
        <section className="bg-white rounded-xl border border-stone-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Gift className="w-4 h-4 text-stone-500" />
            <p className="text-sm font-semibold text-stone-800">Apply Partner Referral Code</p>
          </div>
          {alreadyApplied ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-2">
                <Lock className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="font-semibold text-emerald-800 text-sm mb-1">Applied once only</p>
              <p className="font-mono text-emerald-700 text-sm">{settings.referral_code_applied}</p>
              {settings.referral_code_applied_date && (
                <p className="text-[11px] text-emerald-500 mt-1">
                  Applied: {new Date(settings.referral_code_applied_date).toLocaleDateString("en-PH")}
                </p>
              )}
              <p className="text-xs text-emerald-600 mt-2 flex items-center justify-center gap-1">
                <Check className="w-3 h-3" />10% discount forever active
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-stone-500">Apply once only. 10% discount forever on your subscription.</p>
              <Input
                value={applyCode}
                onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
                placeholder="Enter referral code"
                className="h-12 font-mono tracking-widest text-center text-base"
                disabled={!canApply}
              />
              {!canApply && <p className="text-xs text-red-500">{guard(staffMember, "referral_apply_code").reason}</p>}
              <Button
                className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                onClick={handleApplyCode}
                disabled={applying || !canApply || !applyCode.trim()}
              >
                {applying ? "Applying…" : "Apply Code"}
              </Button>
            </div>
          )}
        </section>

        {/* Invite affiliates */}
        <section className="bg-white rounded-xl border border-stone-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Share2 className="w-4 h-4 text-stone-500" />
            <p className="text-sm font-semibold text-stone-800">Invite a Business Owner</p>
          </div>
          <div className="space-y-3">
            <p className="text-xs text-stone-500">Invite other sari-sari stores to POSync. You earn referral rewards when they subscribe.</p>
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="their@email.com"
              inputMode="email"
              className="h-11"
              disabled={!canInvite}
            />
            {!canInvite && <p className="text-xs text-red-500">{guard(staffMember, "affiliate_invite").reason}</p>}
            <Button
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              onClick={handleInvite}
              disabled={inviting || !canInvite || !inviteEmail.trim()}
            >
              {inviting ? "Sending…" : "Send Invitation"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}