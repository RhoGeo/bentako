import React from "react";
import { ArrowLeft, Receipt, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useStoreScope } from "@/components/lib/storeScope";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import PermissionGate from "@/components/global/PermissionGate";
import { can, guard } from "@/components/lib/permissions";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import OwnerPinModal from "@/components/global/OwnerPinModal";
import { enqueueOfflineEvent } from "@/components/lib/db";
import { getDeviceId } from "@/components/lib/deviceId";
import { syncNow } from "@/components/lib/syncManager";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import CentavosDisplay from "@/components/shared/CentavosDisplay";

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
  const queryClient = useQueryClient();
  const { storeId } = useStoreScope();
  const { staffMember, user } = useCurrentStaff();
  const { settings, rawSettings } = useStoreSettings(storeId);
  const device_id = getDeviceId();

  const urlParams = new URLSearchParams(window.location.search);
  const period = urlParams.get("period") || "today";
  const start = dateStartForPeriod(period);

  const [pinModal, setPinModal] = React.useState({ open: false, action: "", onApproved: null });

  const { data: sales = [] } = useQuery({
    queryKey: ["sales-log", storeId, period],
    queryFn: async () => {
      const rows = await base44.entities.Sale.filter({ store_id: storeId });
      return (rows || [])
        .filter((s) => s.status !== "parked")
        .filter((s) => new Date(s.sale_date || s.created_date) >= start)
        .sort((a, b) => new Date(b.sale_date || b.created_date) - new Date(a.sale_date || a.created_date));
    },
    initialData: [],
  });

  const queueAndSync = async (event_type, payload) => {
    const event_id = uuidv4();
    await enqueueOfflineEvent({
      store_id: storeId,
      event_id,
      device_id,
      client_tx_id: payload.client_tx_id || null,
      event_type,
      payload_json: JSON.stringify(payload),
      created_at_device: Date.now(),
      status: "queued",
    });
    if (navigator.onLine) syncNow(storeId, device_id).catch(() => {});
  };

  const handleVoid = async (sale) => {
    const { allowed, reason } = guard(staffMember, "transaction_void");
    if (!allowed) return toast.error(reason);
    const void_reason = window.prompt("Reason for void?", "customer_request") || "customer_request";
    const payload = { store_id: storeId, sale_id: sale.id, void_request_id: uuidv4(), reason: void_reason, device_id };
    const doIt = async () => {
      await queueAndSync("voidSale", payload);
      toast.success("Void queued.");
      queryClient.invalidateQueries({ queryKey: ["sales-log", storeId, period] });
    };
    if (settings.pin_required_void_refund) {
      setPinModal({ open: true, action: `Void sale ${sale.receipt_number || sale.client_tx_id || sale.id}`, onApproved: doIt });
    } else {
      await doIt();
    }
  };

  const handleRefund = async (sale) => {
    const { allowed, reason } = guard(staffMember, "transaction_refund");
    if (!allowed) return toast.error(reason);
    const refund_reason = window.prompt("Reason for refund?", "customer_request") || "customer_request";
    const payload = { store_id: storeId, sale_id: sale.id, refund_request_id: uuidv4(), reason: refund_reason, device_id };
    const doIt = async () => {
      await queueAndSync("refundSale", payload);
      toast.success("Refund queued.");
      queryClient.invalidateQueries({ queryKey: ["sales-log", storeId, period] });
    };
    if (settings.pin_required_void_refund) {
      setPinModal({ open: true, action: `Refund sale ${sale.receipt_number || sale.client_tx_id || sale.id}`, onApproved: doIt });
    } else {
      await doIt();
    }
  };

  return (
    <PermissionGate staffMember={staffMember} permission="reports_drilldowns" block>
      <div className="pb-24">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
          <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
          <h1 className="text-lg font-bold text-stone-800">Sales</h1>
        </div>

        <div className="px-4 py-4">
          <div className="bg-white rounded-xl border border-stone-100 divide-y divide-stone-50">
            {sales.length === 0 ? (
              <div className="text-center py-12">
                <Receipt className="w-10 h-10 text-stone-300 mx-auto mb-3" />
                <p className="text-sm text-stone-400">No sales found.</p>
              </div>
            ) : sales.map((s) => (
              <div key={s.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0">
                    <Receipt className="w-4 h-4 text-stone-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-800 truncate">{s.receipt_number || s.client_tx_id || s.id}</p>
                    <p className="text-[11px] text-stone-400">{new Date(s.sale_date || s.created_date).toLocaleString("en-PH")} · {s.cashier_email || "—"}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Status: <span className="font-semibold">{s.status}</span></p>
                  </div>
                  <div className="text-right">
                    <CentavosDisplay centavos={s.total_centavos || 0} size="sm" className="text-stone-700" />
                  </div>
                </div>

                {(can(staffMember, "transaction_void") || can(staffMember, "transaction_refund")) && (
                  <div className="flex gap-2 mt-2">
                    {can(staffMember, "transaction_void") && s.status !== "voided" && (
                      <button onClick={() => handleVoid(s)} className="flex-1 h-9 rounded-lg bg-red-50 text-red-600 text-xs font-semibold border border-red-200">
                        Void
                      </button>
                    )}
                    {can(staffMember, "transaction_refund") && s.status !== "refunded" && (
                      <button onClick={() => handleRefund(s)} className="flex-1 h-9 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                        Refund
                      </button>
                    )}
                  </div>
                )}
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

        <OwnerPinModal
          open={pinModal.open}
          onClose={() => setPinModal({ open: false, action: "", onApproved: null })}
          onApproved={async () => {
            const fn = pinModal.onApproved;
            setPinModal({ open: false, action: "", onApproved: null });
            await fn?.();
          }}
          actionContext={pinModal.action}
          storedHash={rawSettings?.owner_pin_hash}
          actorEmail={user?.email}
        />
      </div>
    </PermissionGate>
  );
}
