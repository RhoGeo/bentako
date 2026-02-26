import React, { useMemo, useState } from "react";
import { Receipt, AlertCircle, Ban, RotateCcw, Wallet } from "lucide-react";
import SubpageHeader from "@/components/layout/SubpageHeader";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeFunction } from "@/api/posyncClient";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import PermissionGate from "@/components/global/PermissionGate";
import { can } from "@/components/lib/permissions";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import ConfirmDialog from "@/components/global/ConfirmDialog";
import OwnerPinModal from "@/components/global/OwnerPinModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { enqueueOfflineEvent } from "@/lib/db";
import { getDeviceId, generateEventId } from "@/lib/ids/deviceId";
import { syncNow } from "@/components/lib/syncManager";

function dateStartForPeriod(period) {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d;
  }
  if (period === "month") {
    const d = new Date(now); d.setDate(d.getDate() - 30); return d;
  }
  const d = new Date(now); d.setHours(0, 0, 0, 0); return d;
}

export default function SalesLog() {
  const navigate = useNavigate();
  const { storeId } = useActiveStoreId();
  const { staffMember, user } = useCurrentStaff(storeId);
  const { settings } = useStoreSettings(storeId);
  const queryClient = useQueryClient();

  const [voidOpen, setVoidOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'void' | 'refund'
  const [selectedSale, setSelectedSale] = useState(null);
  const [refundMethod, setRefundMethod] = useState("cash");
  const [refundNote, setRefundNote] = useState("");
  const [voidNote, setVoidNote] = useState("");

  const urlParams = new URLSearchParams(window.location.search);
  const period = urlParams.get("period") || "today";
  const start = dateStartForPeriod(period);

  const { data: sales = [] } = useQuery({
    queryKey: ["sales-log", storeId, period],
    queryFn: async () => {
      const res = await invokeFunction("listSales", {
        store_id: storeId,
        from: start.toISOString(),
        limit: 100,
      });
      const rows = res?.data?.sales || [];
      return (rows || [])
        .filter((s) => s.status !== "parked")
        .sort((a, b) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime());
    },
    initialData: [],
  });

  const canVoid = can(staffMember, "transaction_void");
  const canRefund = can(staffMember, "transaction_refund");
  const pinRequired = !!settings?.pin_required_void_refund;
  const storedPinHash = settings?.owner_pin_hash || null;

  const selectedRefundable = useMemo(() => {
    const c = Number(selectedSale?.refundable_centavos ?? 0);
    return Number.isFinite(c) ? c : 0;
  }, [selectedSale]);

  const kickSyncAndRefresh = async () => {
    if (navigator.onLine) {
      try {
        await syncNow(storeId);
      } catch (_e) {}
    }
    queryClient.invalidateQueries({ queryKey: ["sales-log", storeId] });
    queryClient.invalidateQueries({ queryKey: ["products", storeId] });
    queryClient.invalidateQueries({ queryKey: ["customers", storeId] });
  };

  const enqueueVoid = async ({ owner_pin_proof }) => {
    if (!navigator.onLine) {
      toast.error("Offline — connect to internet to void sales.");
      return;
    }
    if (!selectedSale?.sale_id) return;
    const event_id = generateEventId();
    const device_id = getDeviceId();
    await enqueueOfflineEvent({
      store_id: storeId,
      event_id,
      device_id,
      event_type: "voidSale",
      payload: {
        sale_id: selectedSale.sale_id,
        void_request_id: event_id,
        note: voidNote,
        owner_pin_proof: owner_pin_proof ?? null,
      },
      created_at_device: Date.now(),
    });

    toast.success("Void queued & syncing…");
    setVoidOpen(false);
    setSelectedSale(null);
    setVoidNote("");
    await kickSyncAndRefresh();
  };

  const enqueueRefund = async ({ owner_pin_proof }) => {
    if (!navigator.onLine) {
      toast.error("Offline — connect to internet to refund sales.");
      return;
    }
    if (!selectedSale?.sale_id) return;
    const event_id = generateEventId();
    const device_id = getDeviceId();
    const amt = selectedRefundable;
    await enqueueOfflineEvent({
      store_id: storeId,
      event_id,
      device_id,
      event_type: "refundSale",
      payload: {
        sale_id: selectedSale.sale_id,
        refund_request_id: event_id,
        refund: {
          note: refundNote,
          refunds: amt > 0 ? [{ method: refundMethod, amount_centavos: amt }] : [],
        },
        owner_pin_proof: owner_pin_proof ?? null,
      },
      created_at_device: Date.now(),
    });

    toast.success("Refund queued & syncing…");
    setRefundOpen(false);
    setSelectedSale(null);
    setRefundNote("");
    await kickSyncAndRefresh();
  };

  const startAction = (sale, action) => {
    setSelectedSale(sale);
    setPendingAction(action);
    if (action === "void") setVoidOpen(true);
    if (action === "refund") setRefundOpen(true);
  };

  const requirePinThen = async (action) => {
    // Always show the PIN modal if the store requires it; the modal auto-approves if no PIN is set.
    if (pinRequired) {
      setPendingAction(action);
      setPinOpen(true);
      return;
    }
    // No PIN required
    if (action === "void") await enqueueVoid({ owner_pin_proof: null });
    if (action === "refund") await enqueueRefund({ owner_pin_proof: null });
  };

  return (
    <PermissionGate staffMember={staffMember} permission="reports_drilldowns" block>
      <div className="pb-24">
        <SubpageHeader title="Sales Log" />

        <div className="px-4 py-4">
          <div className="bg-white rounded-xl border border-stone-100 divide-y divide-stone-50">
            {sales.length === 0 ? (
              <div className="text-center py-12">
                <Receipt className="w-10 h-10 text-stone-300 mx-auto mb-3" />
                <p className="text-sm text-stone-400">No sales found.</p>
              </div>
            ) : sales.map((s) => (
              <div key={s.sale_id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0">
                    <Receipt className="w-4 h-4 text-stone-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-800 truncate">{s.receipt_number || s.client_tx_id || s.sale_id}</p>
                    <p className="text-[11px] text-stone-400">{new Date(s.completed_at || s.created_at).toLocaleString("en-PH")} · {s.cashier_email || "—"}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      Status: <span className="font-semibold">{s.status}</span>
                      {s.status === "voided" && <span className="ml-2 text-red-600 font-semibold">(Voided)</span>}
                      {s.status === "refunded" && <span className="ml-2 text-amber-700 font-semibold">(Refunded)</span>}
                    </p>
                    {(canVoid || canRefund) && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canVoid && (s.status === "completed" || s.status === "due") && (
                          <Button
                            variant="outline"
                            className="h-8 px-3 text-xs gap-1"
                            onClick={() => startAction(s, "void")}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Void
                          </Button>
                        )}
                        {canRefund && s.status === "completed" && (
                          <Button
                            variant="outline"
                            className="h-8 px-3 text-xs gap-1"
                            onClick={() => startAction(s, "refund")}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Refund
                          </Button>
                        )}
                        {(s.status === "voided" || s.status === "refunded") && (
                          <span className="text-[11px] text-stone-400 self-center">No further actions.</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <CentavosDisplay centavos={s.total_centavos || 0} size="sm" className="text-stone-700" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!navigator.onLine && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <p className="text-xs text-amber-700">Offline — void/refund will queue and sync when online.</p>
            </div>
          )}
        </div>
      </div>

      {/* Void confirm */}
      <ConfirmDialog
        open={voidOpen}
        title="Void Sale"
        description={
          selectedSale
            ? `This will void the sale and restore stock. Refundable amount: ₱${(selectedSale.refundable_centavos || 0) / 100}. Continue?`
            : ""
        }
        confirmLabel="Void"
        variant="destructive"
        onCancel={() => {
          setVoidOpen(false);
          setVoidNote("");
        }}
        onConfirm={async () => {
          await requirePinThen("void");
        }}
      />

      {/* Refund dialog */}
      <Dialog open={refundOpen} onOpenChange={(v) => !v && setRefundOpen(false)}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-amber-600" />
              Refund Sale
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-stone-700">
              Refundable amount: <span className="font-semibold"><CentavosDisplay centavos={selectedRefundable} size="sm" /></span>
              {selectedRefundable === 0 && (
                <p className="text-xs text-amber-700 mt-1">No recorded payment found for this sale. Stock will still be restored.</p>
              )}
            </div>

            <div>
              <p className="text-xs text-stone-500 mb-1">Refund method</p>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="gcash">GCash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-stone-400 mt-1">(Full refund only in this build)</p>
            </div>

            <div>
              <p className="text-xs text-stone-500 mb-1">Note (optional)</p>
              <Textarea value={refundNote} onChange={(e) => setRefundNote(e.target.value)} placeholder="Reason / reference…" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setRefundOpen(false)}>Cancel</Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={async () => {
                  await requirePinThen("refund");
                }}
              >
                Refund
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Owner PIN modal for void/refund */}
      <OwnerPinModal
        open={pinOpen}
        onClose={() => {
          setPinOpen(false);
          setPendingAction(null);
        }}
        storedHash={storedPinHash}
        actorEmail={user?.email || ""}
        actionContext={pendingAction === "refund" ? "Refund Sale" : "Void Sale"}
        onApproved={async ({ owner_pin_proof }) => {
          setPinOpen(false);
          const action = pendingAction;
          setPendingAction(null);
          if (action === "void") await enqueueVoid({ owner_pin_proof });
          if (action === "refund") await enqueueRefund({ owner_pin_proof });
        }}
      />
    </PermissionGate>
  );
}
