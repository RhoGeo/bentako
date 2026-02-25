import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import OwnerPinModal from "@/components/global/OwnerPinModal";
import { base44 } from "@/api/base44Client";
import { generateEventId, getDeviceId } from "@/components/lib/deviceId";
import { enqueueOfflineEvent, patchCachedProductSnapshot, listOfflineQueue } from "@/components/lib/db";

const REASONS = [
  "damaged",
  "expired",
  "lost",
  "cycle_count",
  "manual_correction",
  "return_from_customer",
  "return_to_supplier",
];

export default function AdjustStockDrawer({
  open,
  onClose,
  storeId,
  settings,
  rawSettings,
  product,
  actorEmail,
  onQueued,
}) {
  const [mode, setMode] = useState("add"); // add | deduct
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("manual_correction");
  const [note, setNote] = useState("");
  const [pinOpen, setPinOpen] = useState(false);

  const productId = product?.id;
  const currentQty = Number(product?.stock_quantity ?? product?.stock_qty ?? 0);
  const allowNegative = !!settings?.allow_negative_stock;

  const deltaQty = useMemo(() => {
    const n = Number(qty || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return mode === "deduct" ? -n : n;
  }, [qty, mode]);

  const previewQty = currentQty + deltaQty;
  const canSave = deltaQty !== 0 && !!reason;

  const { data: queuedLocal = [] } = useQuery({
    queryKey: ["queued-adjustments", storeId, productId],
    enabled: !!open && !!storeId && !!productId,
    queryFn: async () => {
      const rows = await listOfflineQueue(storeId);
      return (rows || [])
        .filter((r) => r.event_type === "adjustStock")
        .map((r) => {
          try {
            return { ...r, payload: JSON.parse(r.payload_json || "{}") };
          } catch (_e) {
            return { ...r, payload: {} };
          }
        })
        .filter((r) => r.payload?.product_id === productId)
        .sort((a, b) => (b.created_at_device || 0) - (a.created_at_device || 0))
        .slice(0, 8);
    },
    initialData: [],
  });

  const { data: history = [] } = useQuery({
    queryKey: ["stock-ledger-adjustments", storeId, productId],
    enabled: !!open && !!storeId && !!productId && navigator.onLine,
    queryFn: async () => {
      // Best-effort: StockLedger may not exist in all schemas.
      try {
        const rows = await base44.entities.StockLedger.filter({
          store_id: storeId,
          product_id: productId,
          reference_type: "adjustment",
        });
        const sorted = (rows || []).slice().sort((a, b) => {
          const ta = new Date(a.created_at || a.created_date || 0).getTime();
          const tb = new Date(b.created_at || b.created_date || 0).getTime();
          return tb - ta;
        });
        return sorted.slice(0, 20);
      } catch (_e) {
        return [];
      }
    },
    initialData: [],
    staleTime: 30_000,
  });

  const resetForm = () => {
    setMode("add");
    setQty("");
    setReason("manual_correction");
    setNote("");
  };

  const queue = async (owner_pin_proof) => {
    if (!storeId || !productId) return;
    if (!canSave) return toast.error("Enter a quantity and reason.");
    if (!allowNegative && previewQty < 0) return toast.error("Negative stock not allowed (Store Settings).");

    const event_id = generateEventId();
    const payload = {
      store_id: storeId,
      product_id: productId,
      delta_qty: deltaQty,
      reason,
      note: note || "",
      adjustment_id: event_id,
      device_id: getDeviceId(),
      owner_pin_proof: owner_pin_proof || null,
    };

    await enqueueOfflineEvent({
      store_id: storeId,
      device_id: getDeviceId(),
      event_id,
      event_type: "adjustStock",
      payload,
      created_at_device: Date.now(),
    });

    // Optimistic patch for offline UI.
    await patchCachedProductSnapshot(storeId, productId, {
      ...(product || {}),
      stock_quantity: previewQty,
      stock_qty: previewQty,
    });

    toast.success("Stock adjustment queued.");
    resetForm();
    onQueued?.();
    onClose?.();
  };

  const handleSave = async () => {
    if (!canSave) return toast.error("Enter a quantity and reason.");

    // Optional PIN requirement (if your schema has it)
    if (settings?.pin_required_stock_adjust && rawSettings?.owner_pin_hash) {
      setPinOpen(true);
      return;
    }

    await queue(null);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose?.()}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Adjust Stock</SheetTitle>
          </SheetHeader>

          {product ? (
            <div className="mt-4 space-y-4">
              <div className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                <p className="font-semibold text-stone-900 truncate">{product.name}</p>
                <p className="text-xs text-stone-500">Barcode: {product.barcode || "—"}</p>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-stone-500">Current stock</div>
                  <div className="text-lg font-bold text-stone-900">{currentQty}</div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="text-xs text-stone-500">Preview</div>
                  <div className={`text-lg font-bold ${previewQty < 0 ? "text-red-600" : "text-stone-900"}`}>{previewQty}</div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setMode("add")}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                    mode === "add" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-stone-600 border-stone-200"
                  }`}
                >
                  Add
                </button>
                <button
                  onClick={() => setMode("deduct")}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                    mode === "deduct" ? "bg-red-600 text-white border-red-600" : "bg-white text-stone-600 border-stone-200"
                  }`}
                >
                  Deduct
                </button>
              </div>

              <div>
                <Label className="text-xs">Quantity</Label>
                <Input
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="0"
                  className="h-11"
                />
              </div>

              <div>
                <Label className="text-xs">Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-11" placeholder="e.g. expired items" />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-12" onClick={() => { resetForm(); onClose?.(); }}>
                  Cancel
                </Button>
                <Button className="flex-1 h-12 bg-blue-600 hover:bg-blue-700" onClick={handleSave}>
                  Queue Adjustment
                </Button>
              </div>

              <Separator />

              {queuedLocal.length > 0 && (
                <div>
                  <p className="font-semibold text-stone-800 text-sm mb-2">Queued (Offline)</p>
                  <div className="space-y-2">
                    {queuedLocal.map((q) => (
                      <div key={q.event_id} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-amber-800">
                            {Number(q.payload?.delta_qty || 0) > 0 ? "+" : ""}
                            {Number(q.payload?.delta_qty || 0)}
                          </div>
                          <div className="text-[11px] text-amber-700">{q.status}</div>
                        </div>
                        <div className="text-[11px] text-amber-700">Reason: {q.payload?.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="font-semibold text-stone-800 text-sm mb-2">History (Adjustments)</p>
                    <div className="space-y-2">
                      {history.map((h) => (
                        <div key={h.id} className="bg-white border border-stone-100 rounded-xl p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-stone-800">
                              {Number(h.qty_delta || 0) > 0 ? "+" : ""}
                              {Number(h.qty_delta || 0)}
                            </div>
                            <div className="text-[11px] text-stone-500">
                              {new Date(h.created_at || h.created_date).toLocaleString("en-PH")}
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-stone-600">
                            {h.reason} · {Number(h.prev_qty ?? 0)} → <span className="font-semibold">{Number(h.resulting_qty ?? 0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="py-10 text-sm text-stone-500">No product selected.</div>
          )}
        </SheetContent>
      </Sheet>

      <OwnerPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onApproved={({ owner_pin_proof }) => {
          setPinOpen(false);
          queue(owner_pin_proof);
        }}
        actionContext={`Adjust stock: ${product?.name || ""}`}
        storedHash={rawSettings?.owner_pin_hash}
        actorEmail={actorEmail}
      />
    </>
  );
}
