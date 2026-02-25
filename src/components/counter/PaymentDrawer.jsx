import React, { useState } from "react";
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
import { Banknote, CreditCard, Smartphone, CheckCircle2 } from "lucide-react";

export default function PaymentDrawer({
  open,
  cartTotalCentavos = 0,
  defaultStatus = "completed",
  customers = [],
  onConfirm,
  onClose,
}) {
  const [saleStatus, setSaleStatus] = useState(defaultStatus);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashTendered, setCashTendered] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");

  const cashCentavos = Math.round(parseFloat(cashTendered || "0") * 100);
  const changeCentavos = Math.max(0, cashCentavos - cartTotalCentavos);
  const balanceDue = saleStatus === "due" ? Math.max(0, cartTotalCentavos - cashCentavos) : 0;

  const canConfirm =
    saleStatus === "due" ? !!customerId : cashCentavos >= cartTotalCentavos || paymentMethod !== "cash";

  const handleConfirm = () => {
    onConfirm?.({
      status: saleStatus,
      payment_method: paymentMethod,
      amount_paid_centavos: saleStatus === "due" ? cashCentavos : Math.max(cashCentavos, cartTotalCentavos),
      change_centavos: changeCentavos,
      balance_due_centavos: balanceDue,
      customer_id: customerId || undefined,
      customer_name: customers.find((c) => c.id === customerId)?.name || "",
      notes,
    });
  };

  const quickAmounts = [20, 50, 100, 200, 500, 1000];

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

          {/* Payment Method */}
          <div>
            <Label className="text-xs text-stone-500 mb-2 block">Payment Method</Label>
            <div className="flex gap-2">
              {[
                { key: "cash", label: "Cash", icon: Banknote },
                { key: "gcash", label: "GCash", icon: Smartphone },
                { key: "maya", label: "Maya", icon: CreditCard },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setPaymentMethod(key)}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-medium flex flex-col items-center gap-1 transition-all touch-target ${
                    paymentMethod === key
                      ? "bg-blue-100 text-blue-700 border-2 border-blue-300"
                      : "bg-stone-50 text-stone-500 border-2 border-transparent"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Cash Tendered */}
          {paymentMethod === "cash" && (
            <div>
              <Label className="text-xs text-stone-500 mb-2 block">Cash Tendered</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
                placeholder="0.00"
                className="h-14 text-2xl text-center font-bold bg-white"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setCashTendered(String(amt))}
                    className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 active:scale-95 transition-all"
                  >
                    ₱{amt}
                  </button>
                ))}
                <button
                  onClick={() => setCashTendered(String(cartTotalCentavos / 100))}
                  className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200 active:scale-95 transition-all"
                >
                  Exact
                </button>
              </div>
              {cashCentavos > 0 && cashCentavos >= cartTotalCentavos && (
                <div className="mt-3 text-center py-2 bg-emerald-50 rounded-lg">
                  <span className="text-xs text-emerald-600">Change: </span>
                  <CentavosDisplay centavos={changeCentavos} size="md" className="text-emerald-700" />
                </div>
              )}
            </div>
          )}

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
              {balanceDue > 0 && (
                <div className="mt-2 text-center py-2 bg-amber-50 rounded-lg">
                  <span className="text-xs text-amber-600">Balance Due: </span>
                  <CentavosDisplay centavos={balanceDue} size="md" className="text-amber-700" />
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