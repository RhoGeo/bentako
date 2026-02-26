import React, { useMemo, useState } from "react";
import { Gift, Copy, Share2, Wallet, CheckCircle2 } from "lucide-react";
// SubpageHeader handles back navigation
import SubpageHeader from "@/components/layout/SubpageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { invokeFunction } from "@/api/posyncClient";
import { useAuth } from "@/lib/AuthContext";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoresForUser } from "@/components/lib/useStores";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { can, guard } from "@/components/lib/permissions";
import CentavosDisplay from "@/components/shared/CentavosDisplay";

function pesosToCentavos(pesosStr) {
  const v = Number(String(pesosStr || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100);
}

export default function Affiliate() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { storeId } = useActiveStoreId();
  const { stores } = useStoresForUser();

  const activeStore = useMemo(() => (stores || []).find((s) => (s.id || s.store_id) === storeId) || null, [stores, storeId]);
  const storeIdValid = !!activeStore;

  const { staffMember } = useCurrentStaff(storeIdValid ? storeId : undefined);
  const { settings } = useStoreSettings(storeIdValid ? storeId : "__none__");

  const canApply = storeIdValid && can(staffMember, "referral_apply_code");
  const canInvite = storeIdValid && can(staffMember, "affiliate_invite");

  const [applyCode, setApplyCode] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const [gcashNumber, setGcashNumber] = useState("");
  const [gcashName, setGcashName] = useState("");
  const [payoutPesos, setPayoutPesos] = useState("");

  const { data: dash, isLoading } = useQuery({
    queryKey: ["affiliate-dashboard"],
    staleTime: 20_000,
    queryFn: async () => {
      const res = await invokeFunction("getAffiliateDashboard", {});
      return res?.data?.data || res?.data || res;
    },
    initialData: null,
  });

  const profile = dash?.data?.profile || dash?.profile || {};
  const totals = dash?.data?.totals || dash?.totals || {};
  const payouts = dash?.data?.payouts || dash?.payouts || [];

  const referralCode = profile.referral_code || `POSYNC-${String(user?.user_id || user?.email || "USER").slice(-6).toUpperCase()}`;

  const alreadyApplied = !!settings?.referral_code_applied;

  const handleCopy = async (txt) => {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Copied!");
    } catch (_e) {
      toast.error("Copy failed");
    }
  };

  const handleSaveGcash = async () => {
    const n = gcashNumber.trim();
    const nm = gcashName.trim();
    if (!n || !nm) {
      toast.error("Enter GCash number and name");
      return;
    }
    await invokeFunction("updateAffiliateProfile", { gcash_number: n, gcash_name: nm });
    toast.success("GCash details saved");
    queryClient.invalidateQueries({ queryKey: ["affiliate-dashboard"] });
  };

  const handleRequestPayout = async () => {
    const amount_centavos = pesosToCentavos(payoutPesos);
    if (amount_centavos <= 0) {
      toast.error("Enter payout amount");
      return;
    }
    try {
      await invokeFunction("requestPayout", { amount_centavos });
      toast.success("Payout requested");
      setPayoutPesos("");
      queryClient.invalidateQueries({ queryKey: ["affiliate-dashboard"] });
    } catch (e) {
      toast.error(e?.message || "Payout request failed");
    }
  };

  const handleApplyCode = async () => {
    const { allowed, reason } = guard(staffMember, "referral_apply_code");
    if (!allowed) {
      toast.error(reason);
      return;
    }
    if (!applyCode.trim()) {
      toast.error("Enter a referral code");
      return;
    }
    if (alreadyApplied) {
      toast.error("Referral code already applied (once only)");
      return;
    }

    await invokeFunction("applyReferralCode", { store_id: storeId, referral_code: applyCode.trim().toUpperCase() });
    toast.success("Referral code applied! 10% discount forever.");
    setApplyCode("");
    queryClient.invalidateQueries({ queryKey: ["store-settings", storeId] });
  };

  const handleInvite = async () => {
    const { allowed, reason } = guard(staffMember, "affiliate_invite");
    if (!allowed) {
      toast.error(reason);
      return;
    }
    if (!inviteEmail.trim()) {
      toast.error("Enter an email");
      return;
    }
    await invokeFunction("inviteAffiliate", { store_id: storeId, invite_email: inviteEmail.trim() });
    toast.success(`Invitation sent to ${inviteEmail}`);
    setInviteEmail("");
  };

  return (
    <div className="pb-24">
      <SubpageHeader title="Affiliate / Referral" />

      <div className="px-4 py-5 space-y-4">
        {/* My referral code */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gift className="w-4 h-4 text-amber-600" />Your Referral Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 bg-stone-50 rounded-xl px-4 py-3 border border-stone-200">
              <p className="font-mono font-bold text-lg text-stone-800 flex-1 tracking-widest truncate">{referralCode}</p>
              <button onClick={() => handleCopy(referralCode)}>
                <Copy className="w-5 h-5 text-stone-500" />
              </button>
            </div>
            <p className="text-xs text-stone-500 mt-2">Share this code to earn referral rewards.</p>
          </CardContent>
        </Card>

        {/* Affiliate dashboard */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="w-4 h-4 text-blue-600" />Affiliate Dashboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-xs text-stone-400">Loading…</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-stone-50 rounded-xl p-3">
                    <p className="text-[10px] text-stone-500">Total earned</p>
                    <CentavosDisplay centavos={Number(totals.total_earned_centavos || 0)} size="sm" className="text-stone-800" />
                  </div>
                  <div className="bg-stone-50 rounded-xl p-3">
                    <p className="text-[10px] text-stone-500">Pending</p>
                    <CentavosDisplay centavos={Number(totals.pending_centavos || 0)} size="sm" className="text-stone-800" />
                  </div>
                  <div className="bg-stone-50 rounded-xl p-3">
                    <p className="text-[10px] text-stone-500">Available</p>
                    <CentavosDisplay centavos={Number(totals.available_centavos || 0)} size="sm" className="text-emerald-700" />
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-stone-700 mb-2">GCash payout details</p>
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <Label className="text-[11px] text-stone-500">GCash Number</Label>
                      <Input className="h-10" value={gcashNumber} onChange={(e) => setGcashNumber(e.target.value)} placeholder={profile.gcash_number || "09xxxxxxxxx"} />
                    </div>
                    <div>
                      <Label className="text-[11px] text-stone-500">GCash Name</Label>
                      <Input className="h-10" value={gcashName} onChange={(e) => setGcashName(e.target.value)} placeholder={profile.gcash_name || "Your Name"} />
                    </div>
                    <Button className="h-10" onClick={handleSaveGcash}>
                      Save GCash Details
                    </Button>
                    <div className="text-[11px] text-stone-500 flex items-center gap-1">
                      <CheckCircle2 className={`w-3 h-3 ${profile.gcash_verified ? "text-emerald-600" : "text-stone-300"}`} />
                      {profile.gcash_verified ? "Verified (self)" : "Required before payout request"}
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-stone-700 mb-2">Request payout</p>
                  <div className="flex gap-2">
                    <Input
                      className="h-10"
                      value={payoutPesos}
                      onChange={(e) => setPayoutPesos(e.target.value)}
                      placeholder="Amount (₱)"
                      inputMode="decimal"
                    />
                    <Button className="h-10" onClick={handleRequestPayout}>
                      Request
                    </Button>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-2">Requires GCash details saved.</p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-stone-700 mb-2">Recent payout requests</p>
                  {payouts.length === 0 ? (
                    <p className="text-xs text-stone-400">None yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {payouts.slice(0, 5).map((p) => (
                        <div key={p.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-3 py-2">
                          <div>
                            <p className="text-xs font-medium text-stone-700">{p.status}</p>
                            <p className="text-[10px] text-stone-400">{p.created_at ? new Date(p.created_at).toLocaleDateString("en-PH") : ""}</p>
                          </div>
                          <CentavosDisplay centavos={Number(p.amount_centavos || 0)} size="sm" className="text-stone-800" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Store-specific referral apply */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gift className="w-4 h-4 text-stone-500" />Apply Partner Referral Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!storeIdValid ? (
              <p className="text-xs text-stone-500">Select a store to apply a referral code (once only).</p>
            ) : alreadyApplied ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-emerald-800">Applied once only</p>
                <p className="text-xs text-emerald-700 font-mono mt-1">{settings.referral_code_applied}</p>
                <p className="text-[11px] text-emerald-600 mt-2">10% discount forever active</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-stone-500">Apply once only. 10% discount forever.</p>
                <Input
                  value={applyCode}
                  onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
                  placeholder="Enter referral code"
                  className="h-12 font-mono tracking-widest text-center text-base"
                  disabled={!canApply}
                />
                {!canApply && storeIdValid && <p className="text-xs text-red-500">{guard(staffMember, "referral_apply_code").reason}</p>}
                <Button className="w-full h-11" onClick={handleApplyCode} disabled={!canApply || !applyCode.trim()}>
                  Apply Code
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invite store owners */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Share2 className="w-4 h-4 text-stone-500" />Invite a Business Owner
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!storeIdValid ? (
              <p className="text-xs text-stone-500">Select a store to send invites (permission gated).</p>
            ) : (
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
                <Button className="w-full h-11" onClick={handleInvite} disabled={!canInvite || !inviteEmail.trim()}>
                  Send Invitation
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
