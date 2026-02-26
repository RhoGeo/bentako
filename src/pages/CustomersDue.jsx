import React, { useState } from "react";
import { invokeFunction } from "@/api/posyncClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import { Users, CreditCard, Clock, ChevronRight, Banknote, Smartphone, Landmark, WalletCards } from "lucide-react";
import SubpageHeader from "@/components/layout/SubpageHeader";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { can, guard } from "@/components/lib/permissions";
import { auditLog } from "@/components/lib/auditLog";
import { toast } from "sonner";
import { differenceInDays } from "date-fns";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { enqueueOfflineEvent, getAllCachedCustomers, listQueuedCustomerPayments, patchCachedCustomerSnapshot } from "@/lib/db";
import { generateEventId, getDeviceId } from "@/lib/ids/deviceId";
import { syncNow } from "@/components/lib/syncManager";

export default function CustomersDue() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { staffMember, user } = useCurrentStaff(storeId);
  const canRecordPayment = can(staffMember, "customers_record_payment");
  const canView = can(staffMember, "customers_view");

  const [filter, setFilter] = useState("all");
  const [paymentSheet, setPaymentSheet] = useState({ open: false, customer: null });
  const [payForm, setPayForm] = useState({ amount: "", method: "cash", note: "" });
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  // Offline-first: read customers from Dexie cache (kept fresh by SyncManager pullUpdates).
  const { data: customers = [] } = useQuery({
    queryKey: ["cached-customers", storeId],
    queryFn: () => getAllCachedCustomers(storeId),
    refetchInterval: 8_000,
    initialData: [],
  });

  // Online-only: full ledger (due sales + customer payments).
  const { data: ledgerResp = null } = useQuery({
    queryKey: ["customer-ledger", storeId, selectedCustomer?.id],
    queryFn: async () => {
      const res = await invokeFunction("getCustomerLedger", {
        store_id: storeId,
        customer_id: selectedCustomer?.id,
      });
      return res?.data?.data || res?.data || null;
    },
    enabled: !!selectedCustomer && !!storeId && navigator.onLine,
    staleTime: 10_000,
    initialData: null,
  });

  const { data: queuedPayments = [] } = useQuery({
    queryKey: ["queued-customer-payments", storeId, selectedCustomer?.id],
    queryFn: () => listQueuedCustomerPayments(storeId, selectedCustomer?.id),
    enabled: !!selectedCustomer && !!storeId,
    refetchInterval: 6_000,
    initialData: [],
  });

  const now = new Date();
  const dueCustomers = customers
    .filter((c) => c.balance_due_centavos > 0)
    .filter((c) => {
      if (filter === "all") return true;
      const lastTx = c.last_transaction_date ? new Date(c.last_transaction_date) : new Date(c.created_date);
      const days = differenceInDays(now, lastTx);
      if (filter === "8-30") return days >= 8 && days <= 30;
      if (filter === "31+") return days > 30;
      return true;
    })
    .sort((a, b) => {
      // Primary: highest due. Secondary: oldest activity (more days).
      const byDue = Number(b.balance_due_centavos || 0) - Number(a.balance_due_centavos || 0);
      if (byDue !== 0) return byDue;
      const la = a.last_transaction_date ? new Date(a.last_transaction_date) : new Date(a.created_date);
      const lb = b.last_transaction_date ? new Date(b.last_transaction_date) : new Date(b.created_date);
      return differenceInDays(now, lb) - differenceInDays(now, la);
    });

  const totalDue = dueCustomers.reduce((s, c) => s + c.balance_due_centavos, 0);

  const openPayment = (customer) => {
    const { allowed, reason } = guard(staffMember, "customers_record_payment");
    if (!allowed) { toast.error(reason); return; }
    setPaymentSheet({ open: true, customer });
    setPayForm({ amount: "", method: "cash", note: "" });
  };

  const handleRecordPayment = async () => {
    const { customer } = paymentSheet;
    const amount = parseFloat(payForm.amount || "0");
    if (amount <= 0) { toast.error("Amount must be greater than 0."); return; }
    if (amount > customer.balance_due_centavos / 100) { toast.error("Amount exceeds balance. Strict overpayment policy."); return; }
    if (!payForm.method) { toast.error("Payment method required."); return; }

    setSaving(true);
    const isOnline = navigator.onLine;
    const event_id = generateEventId();
    const amountCentavos = Math.round(amount * 100);

    // Queue recordPayment event (offline-first)
    await enqueueOfflineEvent({
      store_id: storeId,
      event_id,
      device_id: getDeviceId(),
      event_type: "recordPayment",
      payload: {
        store_id: storeId,
        device_id: getDeviceId(),
        customer_id: customer.id,
        payment_request_id: event_id,
        payment: { method: payForm.method, amount_centavos: amountCentavos, note: payForm.note || "" },
      },
      created_at_device: Date.now(),
    });

    // Optimistic local balance update (offline-first UX)
    try {
      await patchCachedCustomerSnapshot(storeId, customer.id, {
        ...customer,
        balance_due_centavos: Math.max(0, Number(customer.balance_due_centavos || 0) - amountCentavos),
        last_transaction_date: new Date().toISOString(),
      });
    } catch (_e) {}

    if (isOnline) {
      syncNow(storeId).catch(() => {});
    }

    await auditLog("payment_recorded", `Payment ₱${amount.toFixed(2)} recorded for ${customer.name}`, {
      actor_email: user?.email,
      reference_id: customer.id,
      amount_centavos: amountCentavos,
      metadata: { method: payForm.method, offline: !isOnline, event_id },
    });

    queryClient.invalidateQueries({ queryKey: ["cached-customers", storeId] });
    queryClient.invalidateQueries({ queryKey: ["customer-ledger", storeId, customer.id] });
    queryClient.invalidateQueries({ queryKey: ["queued-customer-payments", storeId, customer.id] });
    toast.success(isOnline ? `Payment recorded!` : "Queued — magsi-sync pag online.");
    setPaymentSheet({ open: false, customer: null });
    setSaving(false);
  };

  const copyReminder = (customer) => {
    const msg = `Hi ${customer.name}! Ito ay paalala na ikaw ay may utang sa aming tindahan na ₱${(customer.balance_due_centavos / 100).toFixed(2)}. Salamat at mangyaring bayaran na po. 😊`;
    navigator.clipboard.writeText(msg);
    toast.success("Reminder copied to clipboard!");
  };

  if (!canView) {
    return (
      <div className="pb-24">
        <SubpageHeader title="Customers (Utang)" />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <p className="text-stone-500 text-sm">{guard(staffMember, "customers_view").reason}</p>
        </div>
      </div>
    );
  }

  // Customer detail view
  if (selectedCustomer) {
    const dueSales = ledgerResp?.due_sales || [];
    const customerPayments = ledgerResp?.customer_payments || [];

    const ledger = [
      ...dueSales.map((s) => ({
        type: "sale",
        date: s.sale_date,
        amount: Number(s.balance_due_centavos || s.total_centavos || 0),
        ref: s.receipt_number || s.client_tx_id || s.sale_id,
        by: s.cashier_name,
      })),
      ...customerPayments.map((p) => ({
        type: "payment",
        date: p.created_at,
        amount: -Number(p.amount_centavos || 0),
        ref: p.payment_request_id || p.payment_id,
        by: p.recorded_by_name,
        status: "synced",
      })),
      ...queuedPayments.map((p) => ({
        type: "payment",
        date: new Date(p.created_at_device).toISOString(),
        amount: -Number(p.amount_centavos || 0),
        ref: p.event_id,
        by: user?.email,
        status: p.status || "queued",
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return (
      <div className="pb-24">
        <SubpageHeader
          title={selectedCustomer.name}
          subtitle="Customer ledger"
          onBack={() => setSelectedCustomer(null)}
        />
        <div className="px-4 py-4 space-y-4">
          {/* Summary */}
          <div className="bg-red-50 rounded-xl p-4">
            <p className="text-xs text-red-500 font-semibold mb-1">Outstanding Balance</p>
            <CentavosDisplay centavos={selectedCustomer.balance_due_centavos} size="2xl" className="text-red-700" />
            {selectedCustomer.phone && <p className="text-xs text-stone-500 mt-2">{selectedCustomer.phone}</p>}
          </div>
          {/* Actions */}
          <div className="flex gap-2">
            {canRecordPayment && (
              <Button className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => openPayment(selectedCustomer)}>
                <CreditCard className="w-4 h-4 mr-2" />Record Payment
              </Button>
            )}
            <Button variant="outline" className="flex-1 h-11" onClick={() => copyReminder(selectedCustomer)}>
              Copy Reminder
            </Button>
          </div>
          {/* Ledger */}
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Ledger</p>
            <div className="bg-white rounded-xl border border-stone-100 divide-y divide-stone-50">
              {!navigator.onLine && (
                <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50">
                  Offline — showing queued payments only. Connect to internet to load full ledger.
                </div>
              )}
              {ledger.length === 0 ? (
                <div className="text-center py-8 text-stone-400 text-sm">No transactions.</div>
              ) : ledger.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${entry.type === "payment" ? "bg-emerald-100" : "bg-red-100"}`}>
                    {entry.type === "payment" ? <Banknote className="w-4 h-4 text-emerald-600" /> : <Clock className="w-4 h-4 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-stone-700">{entry.type === "payment" ? "Payment" : "Due Sale"}</p>
                    <p className="text-[10px] text-stone-400">{new Date(entry.date).toLocaleDateString("en-PH")} · {entry.by || "—"}</p>
                    {entry.status === "queued" && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Queued</span>}
                    {entry.status === "failed_retry" && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Retry</span>}
                    {entry.status === "failed_permanent" && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Failed</span>}
                  </div>
                  <CentavosDisplay
                    centavos={Math.abs(entry.amount)}
                    size="sm"
                    className={entry.amount < 0 ? "text-emerald-600" : "text-red-600"}
                    showSign={false}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <SubpageHeader title="Customers (Utang)" />

      {/* Summary */}
      <div className="px-4 py-4">
        <div className="bg-red-50 rounded-xl p-4 text-center">
          <p className="text-xs text-red-500 uppercase font-semibold mb-1">Total Outstanding</p>
          <CentavosDisplay centavos={totalDue} size="2xl" className="text-red-700" />
          <p className="text-xs text-red-400 mt-1">{dueCustomers.length} customers</p>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 pb-3 flex gap-2">
        {["all", "8-30", "31+"].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${filter === f ? "bg-red-600 text-white" : "bg-white text-stone-600 border border-stone-200"}`}>
            {f === "all" ? "All with balance" : f === "8-30" ? "8–30 days" : "31+ days"}
          </button>
        ))}
      </div>

      {/* Customer list */}
      <div className="px-4 space-y-2">
        {dueCustomers.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-400">Walang utang. Nice!</p>
          </div>
        ) : dueCustomers.map((cust) => {
          const lastTx = cust.last_transaction_date ? new Date(cust.last_transaction_date) : new Date(cust.created_date);
          const days = differenceInDays(now, lastTx);
          return (
            <div key={cust.id} className="bg-white rounded-xl border border-stone-100 shadow-sm">
              <button className="w-full flex items-center gap-3 p-4 text-left" onClick={() => setSelectedCustomer(cust)}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-stone-800">{cust.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {cust.phone && <p className="text-[11px] text-stone-400">{cust.phone}</p>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${days > 30 ? "bg-red-100 text-red-700" : days >= 8 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>
                      {days}d
                    </span>
                  </div>
                </div>
                <CentavosDisplay centavos={cust.balance_due_centavos} size="md" className="text-red-600 flex-shrink-0" />
                <ChevronRight className="w-4 h-4 text-stone-300 flex-shrink-0" />
              </button>
              {canRecordPayment && (
                <div className="border-t border-stone-50 px-4 py-2">
                  <Button size="sm" variant="ghost" className="h-8 text-emerald-700 text-xs" onClick={() => openPayment(cust)}>
                    <CreditCard className="w-3.5 h-3.5 mr-1.5" />Record Payment
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment Sheet */}
      <Sheet open={paymentSheet.open} onOpenChange={(v) => !v && setPaymentSheet({ open: false, customer: null })}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 max-h-[80vh]">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-stone-100">
            <SheetTitle>Record Payment — {paymentSheet.customer?.name}</SheetTitle>
          </SheetHeader>
          <div className="px-5 py-4 space-y-4">
            {paymentSheet.customer && (
              <div className="bg-red-50 rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-red-500">Balance</p>
                <CentavosDisplay centavos={paymentSheet.customer.balance_due_centavos} size="lg" className="text-red-700" />
              </div>
            )}
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Amount (₱)</Label>
              <Input type="number" inputMode="decimal" value={payForm.amount} onChange={(e) => setPayForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="h-14 text-2xl text-center font-bold" autoFocus />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Method</Label>
              <div className="flex gap-2">
                {[
                  { k: "cash", label: "Cash", icon: Banknote },
                  { k: "gcash", label: "GCash", icon: Smartphone },
                  { k: "bank_transfer", label: "Bank", icon: Landmark },
                  { k: "card", label: "Card", icon: WalletCards },
                  { k: "other", label: "Other", icon: CreditCard },
                ].map(({ k, label, icon: Icon }) => (
                  <button key={k} onClick={() => setPayForm(f => ({ ...f, method: k }))}
                    className={`flex-1 py-3 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all ${payForm.method === k ? "bg-blue-100 text-blue-700 border-2 border-blue-300" : "bg-stone-50 text-stone-500 border-2 border-transparent"}`}>
                    <Icon className="w-4 h-4" />{label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Note (optional)</Label>
              <Textarea value={payForm.note} onChange={(e) => setPayForm(f => ({ ...f, note: e.target.value }))} className="resize-none h-16" />
            </div>
            {!navigator.onLine && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                Offline — payment will be queued and synced when online.
              </div>
            )}
            <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold touch-target" disabled={saving || !payForm.amount} onClick={handleRecordPayment}>
              {saving ? "Saving…" : "Record Payment"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}