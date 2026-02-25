import React, { useState } from "react";
import { ArrowLeft, Wallet, Plus, WifiOff, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can, guard } from "@/components/lib/permissions";
import { toast } from "sonner";
import { useActiveStoreId } from "@/components/lib/activeStore";

const STATUS_CONFIG = {
  pending: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50", label: "Pending" },
  processing: { icon: Clock, color: "text-blue-600", bg: "bg-blue-50", label: "Processing" },
  completed: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", label: "Completed" },
  rejected: { icon: XCircle, color: "text-red-600", bg: "bg-red-50", label: "Rejected" },
};

export default function Payouts() {
  const navigate = useNavigate();
  const { storeId } = useActiveStoreId();
  const { staffMember, user } = useCurrentStaff(storeId);
  const canView = can(staffMember, "payouts_view");
  const canRequest = can(staffMember, "payouts_request");

  const [requestSheet, setRequestSheet] = useState(false);
  const [form, setForm] = useState({ amount: "", gcash_number: "", gcash_name: "" });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);

  const isOnline = navigator.onLine;

  const { data: payouts = [] } = useQuery({
    queryKey: ["payouts", storeId],
    // This build does not include payout tables in the DB schema.
    // Keep the page non-crashing and consistent with permissions/UX.
    queryFn: async () => [],
    enabled: canView,
    initialData: [],
  });

  const totalEarned = payouts.filter(p => p.status === "completed").reduce((s, p) => s + p.amount_centavos, 0);
  const pending = payouts.filter(p => p.status === "pending" || p.status === "processing").reduce((s, p) => s + p.amount_centavos, 0);
  const lastPayout = payouts.filter(p => p.status === "completed").sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

  const handleRequest = async () => {
    const { allowed, reason } = guard(staffMember, "payouts_request");
    if (!allowed) { toast.error(reason); return; }
    toast.error("Payouts module is not enabled in this deployment.");
  };

  if (!canView) {
    return (
      <div className="pb-24">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
          <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
          <h1 className="text-lg font-bold text-stone-800">Payouts</h1>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <p className="text-stone-500 text-sm">{guard(staffMember, "payouts_view").reason}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">Payouts</h1>
        {canRequest && (
          <Button onClick={() => setRequestSheet(true)} className="h-9 bg-blue-600 hover:bg-blue-700 px-3" disabled={!isOnline}>
            <Plus className="w-4 h-4 mr-1" />Request
          </Button>
        )}
      </div>

      <div className="px-4 py-5 space-y-4">
        {/* Earnings overview */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-stone-100 p-4">
            <p className="text-[10px] text-stone-400 uppercase mb-1">Total Earned</p>
            <CentavosDisplay centavos={totalEarned} size="lg" className="text-emerald-700" />
          </div>
          <div className="bg-white rounded-xl border border-stone-100 p-4">
            <p className="text-[10px] text-stone-400 uppercase mb-1">Pending</p>
            <CentavosDisplay centavos={pending} size="lg" className="text-amber-600" />
          </div>
        </div>
        {lastPayout && (
          <div className="bg-stone-50 rounded-lg px-3 py-2 text-xs text-stone-500">
            Last payout: {new Date(lastPayout.created_date).toLocaleDateString("en-PH")} —
            <CentavosDisplay centavos={lastPayout.amount_centavos} size="xs" className="ml-1 text-stone-700" />
          </div>
        )}

        {!isOnline && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-600" />
            <p className="text-xs text-amber-700">Need internet to request payout. Viewing cached history.</p>
          </div>
        )}

        {/* Payout history */}
        <div>
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Payout History</p>
          <div className="bg-white rounded-xl border border-stone-100 divide-y divide-stone-50">
            {payouts.length === 0 ? (
              <div className="text-center py-10">
                <Wallet className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                <p className="text-sm text-stone-400">No payouts yet.</p>
              </div>
            ) : payouts.map((p) => {
              const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.pending;
              const Icon = cfg.icon;
              return (
                <button key={p.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50" onClick={() => setSelected(selected?.id === p.id ? null : p)}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800">{new Date(p.created_date).toLocaleDateString("en-PH")}</p>
                    {p.reference_id && <p className="text-[10px] text-stone-400 font-mono">{p.reference_id}</p>}
                    {selected?.id === p.id && p.reject_reason && <p className="text-xs text-red-500 mt-0.5">{p.reject_reason}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <CentavosDisplay centavos={p.amount_centavos} size="sm" className="text-stone-700" />
                    <span className={`text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Request payout sheet */}
      <Sheet open={requestSheet} onOpenChange={setRequestSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 max-h-[85vh]">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-stone-100">
            <SheetTitle>Request Payout</SheetTitle>
          </SheetHeader>
          <div className="px-5 py-4 space-y-4">
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Amount (₱)</Label>
              <Input type="number" inputMode="decimal" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="h-14 text-2xl text-center font-bold" autoFocus />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">GCash Number</Label>
              <Input value={form.gcash_number} onChange={(e) => setForm(f => ({ ...f, gcash_number: e.target.value }))} placeholder="09XXXXXXXXX" inputMode="tel" className="h-11" />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">GCash Account Name</Label>
              <Input value={form.gcash_name} onChange={(e) => setForm(f => ({ ...f, gcash_name: e.target.value }))} placeholder="Full name on GCash" className="h-11" />
            </div>
            <Button className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold" onClick={handleRequest} disabled={saving || !form.amount || !form.gcash_number || !form.gcash_name}>
              {saving ? "Submitting…" : "Submit Request"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}