import React, { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import {
  Banknote,
  CreditCard,
  Smartphone,
  CheckCircle2,
  Plus,
  Trash2,
  Landmark,
  WalletCards,
} from "lucide-react";

const PAYMENT_METHODS = [
  { key: "cash", label: "Cash", icon: Banknote },
  { key: "gcash", label: "GCash", icon: Smartphone },
  { key: "bank_transfer", label: "Bank", icon: Landmark },
  { key: "card", label: "Card", icon: WalletCards },
  { key: "other", label: "Other", icon: CreditCard },
];

function pesoToCentavos(pesoStr) {
  const n = Number.parseFloat(String(pesoStr || "").trim() || "0");
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function newPaymentLine(method = "cash") {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    method,
    amount_peso: "",
  };
}

export default function PaymentDrawer({
  open,
  cartTotalCentavos = 0,
  defaultStatus = "completed",
  customers = [],
  onConfirm,
  onClose,
}) {
  const [saleStatus, setSaleStatus] = useState(defaultStatus);
  const [payments, setPayments] = useState([newPaymentLine("cash")]);
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setSaleStatus(defaultStatus);
    setPayments([newPaymentLine("cash")]);
    setCustomerId("");
    setNotes("");
  }, [open, defaultStatus]);

  const paymentCentavos = useMemo(() => {
    const lines = payments.map((p) => ({
      ...p,
      amount_centavos: pesoToCentavos(p.amount_peso),
    }));
    const total_paid_centavos = lines.reduce(
      (s, p) => s + (p.amount_centavos || 0),
      0
    );
    const cash_paid = lines
      .filter((p) => p.method === "cash")
      .reduce((s, p) => s + (p.amount_centavos || 0), 0);
    const noncash_paid = lines
      .filter((p) => p.method !== "cash")
      .reduce((s, p) => s + (p.amount_centavos || 0), 0);

    // Retail-correct change: only cash can generate change.
    // We still send full tendered amounts to the server; the client UX keeps it sane.
    const remaining_after_noncash = Math.max(0, cartTotalCentavos - noncash_paid);
    const change_centavos =
      saleStatus === "completed" ? Math.max(0, cash_paid - remaining_after_noncash) : 0;
    const balance_due_centavos =
      saleStatus === "due"
        ? Math.max(0, cartTotalCentavos - Math.min(total_paid_centavos, cartTotalCentavos))
        : 0;
    return {
      lines,
      total_paid_centavos,
      cash_paid,
      noncash_paid,
      change_centavos,
      balance_due_centavos,
    };
  }, [payments, saleStatus, cartTotalCentavos]);

  const selectedCustomer = customers.find((c) => c.id === customerId) || null;
  const exceedsCredit = useMemo(() => {
    if (!selectedCustomer) return false;
    const limit = Number(selectedCustomer.credit_limit_centavos || 0);
    if (!limit) return false;
    const current = Number(selectedCustomer.balance_due_centavos || 0);
    const next = current + paymentCentavos.balance_due_centavos;
    return next > limit;
  }, [selectedCustomer, paymentCentavos.balance_due_centavos]);

  const hasAnyPayment = paymentCentavos.lines.some(
    (p) => (p.amount_centavos || 0) > 0
  );
  const canConfirm = useMemo(() => {
    // Utang: customer required. Payments can be 0..total.
    if (saleStatus === "due") {
      if (!customerId) return false;
      if (!selectedCustomer) return false;
      if (selectedCustomer.allow_utang === false) return false;
      // Do not allow overpaying on a due sale – switch to Paid instead.
      if (paymentCentavos.total_paid_centavos > cartTotalCentavos) return false;
      return true;
    }

    // Paid: require >= total. Also disallow non-cash overpayment (only cash can create change).
    if (!hasAnyPayment) return false;
    if (paymentCentavos.total_paid_centavos < cartTotalCentavos) return false;
    const overage = paymentCentavos.total_paid_centavos - cartTotalCentavos;
    if (overage > 0 && overage > (paymentCentavos.cash_paid || 0)) return false;
    return true;
  }, [
    saleStatus,
    customerId,
    selectedCustomer,
    paymentCentavos.total_paid_centavos,
    paymentCentavos.cash_paid,
    cartTotalCentavos,
    hasAnyPayment,
  ]);

  const handleConfirm = () => {
    const cleaned = paymentCentavos.lines
      .map((p) => ({ method: p.method, amount_centavos: p.amount_centavos || 0 }))
      .filter((p) => p.amount_centavos > 0);

    const payment_summary_method =
      cleaned.length > 1
        ? "mixed"
        : cleaned?.[0]?.method || (saleStatus === "due" ? "mixed" : "cash");

    onConfirm?.({
      status: saleStatus,
      payments: cleaned,
      payment_summary_method,
      amount_paid_centavos: paymentCentavos.total_paid_centavos,
      change_centavos: paymentCentavos.change_centavos,
      balance_due_centavos: paymentCentavos.balance_due_centavos,
      customer_id: customerId || undefined,
      customer_name: selectedCustomer?.name || "",
      notes,
    });
  };

  const quickAmounts = [20, 50, 100, 200, 500, 1000];

  const addPaymentLine = () => setPayments((prev) => [...prev, newPaymentLine("gcash")]);
  const removePaymentLine = (id) =>
    setPayments((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.id !== id)));
  const updatePaymentLine = (id, patch) =>
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose?.()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-stone-100">
          <SheetTitle className="text-lg">Payment</SheetTitle>
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          {/* Total */}
          <div className="text-center py-3 bg-blue-50 rounded-xl">
            <p className="text-xs text-blue-600 font-medium mb-1">TOTAL</p>
            <CentavosDisplay centavos={cartTotalCentavos} size="2xl" className="text-blue-800" />
          </div>

          {/* Sale Type */}
          <div className="flex gap-2">
            <button
              onClick={() => setSaleStatus("completed")}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all touch-target ${
                saleStatus === "completed"
                  ? "bg-emerald-600 text-white shadow-md"
                  : "bg-stone-100 text-stone-600"
              }`}
            >
              <CheckCircle2 className="w-4 h-4 mx-auto mb-1" />
              Paid
            </button>
            <button
              onClick={() => setSaleStatus("due")}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all touch-target ${
                saleStatus === "due"
                  ? "bg-amber-500 text-white shadow-md"
                  : "bg-stone-100 text-stone-600"
              }`}
            >
              <Banknote className="w-4 h-4 mx-auto mb-1" />
              Utang
            </button>
          </div>

          {/* Payments (split supported) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-stone-500">Payments</Label>
              <button
                type="button"
                onClick={addPaymentLine}
                className="text-xs font-semibold text-blue-700 flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            <div className="space-y-2">
              {payments.map((p, idx) => {
                const methodMeta =
                  PAYMENT_METHODS.find((m) => m.key === p.method) ||
                  PAYMENT_METHODS[0];
                const Icon = methodMeta.icon;
                const isCash = p.method === "cash";
                return (
                  <div
                    key={p.id}
                    className="bg-white border border-stone-100 rounded-xl p-3"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-stone-50 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-stone-500" />
                      </div>
                      <div className="flex-1">
                        <Select
                          value={p.method}
                          onValueChange={(v) => updatePaymentLine(p.id, { method: v })}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Method" />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_METHODS.map((m) => (
                              <SelectItem key={m.key} value={m.key}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <button
                        type="button"
                        onClick={() => removePaymentLine(p.id)}
                        className={`touch-target rounded-lg ${
                          payments.length <= 1
                            ? "opacity-30 pointer-events-none"
                            : ""
                        }`}
                        aria-label="Remove payment line"
                      >
                        <Trash2 className="w-4 h-4 text-stone-400" />
                      </button>
                    </div>

                    <div className="mt-3">
                      <Label className="text-[11px] text-stone-500 mb-1.5 block">
                        {isCash ? "Cash Tendered (₱)" : "Amount (₱)"}
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={p.amount_peso}
                        onChange={(e) =>
                          updatePaymentLine(p.id, { amount_peso: e.target.value })
                        }
                        placeholder="0.00"
                        className="h-12 text-lg text-center font-bold bg-white"
                      />

                      {isCash && idx === 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {quickAmounts.map((amt) => (
                            <button
                              key={amt}
                              type="button"
                              onClick={() =>
                                updatePaymentLine(p.id, {
                                  amount_peso: String(amt),
                                })
                              }
                              className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 active:scale-95 transition-all"
                            >
                              ₱{amt}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              updatePaymentLine(p.id, {
                                amount_peso: String(cartTotalCentavos / 100),
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200 active:scale-95 transition-all"
                          >
                            Exact
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <div className="bg-stone-50 rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-stone-500">Paid</p>
                <CentavosDisplay
                  centavos={paymentCentavos.total_paid_centavos}
                  size="md"
                  className="text-stone-800"
                />
              </div>
              {saleStatus === "completed" &&
                paymentCentavos.change_centavos > 0 && (
                  <div className="text-right">
                    <p className="text-[11px] text-emerald-600">Change</p>
                    <CentavosDisplay
                      centavos={paymentCentavos.change_centavos}
                      size="md"
                      className="text-emerald-700"
                    />
                  </div>
                )}
              {saleStatus === "due" && (
                <div className="text-right">
                  <p className="text-[11px] text-amber-600">Balance Due</p>
                  <CentavosDisplay
                    centavos={paymentCentavos.balance_due_centavos}
                    size="md"
                    className="text-amber-700"
                  />
                </div>
              )}
            </div>

            {saleStatus === "completed" &&
              paymentCentavos.total_paid_centavos > cartTotalCentavos &&
              (paymentCentavos.total_paid_centavos - cartTotalCentavos) >
                (paymentCentavos.cash_paid || 0) && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                  Only <b>cash</b> can produce change. Reduce non-cash amounts or adjust cash tendered.
                </div>
              )}

            {saleStatus === "due" &&
              paymentCentavos.total_paid_centavos > cartTotalCentavos && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                  Overpayment detected. If fully paid, switch to <b>Paid</b>.
                </div>
              )}
          </div>

          {/* Customer for Utang */}
          {saleStatus === "due" && (
            <div>
              <Label className="text-xs text-stone-500 mb-2 block">Customer (Utang)</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Piliin ang customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.balance_due_centavos > 0 && (
                        <span className="text-amber-600 ml-2">
                          (₱{(c.balance_due_centavos / 100).toFixed(2)} utang)
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCustomer?.allow_utang === false && (
                <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                  This customer is not allowed to utang.
                </div>
              )}
              {exceedsCredit && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  Warning: this utang would exceed the customer credit limit.
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <Label className="text-xs text-stone-500 mb-2 block">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes..."
              className="resize-none h-20"
            />
          </div>

          {/* Confirm */}
          <Button
            className={`w-full h-14 text-base font-bold touch-target safe-bottom ${
              saleStatus === "due"
                ? "bg-amber-500 hover:bg-amber-600 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            }`}
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {saleStatus === "due" ? "Record Utang" : "Complete Sale"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}