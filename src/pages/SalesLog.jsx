import React from "react";
import { ArrowLeft, Receipt, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { invokeFunction } from "@/api/posyncClient";
import { useStoreScope } from "@/components/lib/storeScope";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import PermissionGate from "@/components/global/PermissionGate";
import { can } from "@/components/lib/permissions";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
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
  const { storeId } = useStoreScope();
  const { staffMember, user } = useCurrentStaff();
  const { settings, rawSettings } = useStoreSettings(storeId);

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
              <div key={s.sale_id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0">
                    <Receipt className="w-4 h-4 text-stone-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-800 truncate">{s.receipt_number || s.client_tx_id || s.sale_id}</p>
                    <p className="text-[11px] text-stone-400">{new Date(s.completed_at || s.created_at).toLocaleString("en-PH")} · {s.cashier_email || "—"}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Status: <span className="font-semibold">{s.status}</span></p>
                  </div>
                  <div className="text-right">
                    <CentavosDisplay centavos={s.total_centavos || 0} size="sm" className="text-stone-700" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {(can(staffMember, "transaction_void") || can(staffMember, "transaction_refund")) && (
            <div className="mt-3 bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-xs text-stone-600">
              Void/Refund actions are not enabled in this build yet. (Sales list + reporting are available.)
            </div>
          )}

          {!navigator.onLine && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <p className="text-xs text-amber-700">Offline — void/refund will queue and sync when online.</p>
            </div>
          )}
        </div>
      </div>
    </PermissionGate>
  );
}
