import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeFunction } from "@/api/posyncClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import OwnerPinModal from "@/components/global/OwnerPinModal";

import { generateEventId, getDeviceId } from "@/components/lib/deviceId";
import { enqueueOfflineEvent, patchCachedProductSnapshot, listOfflineQueue } from "@/lib/db";
import CentavosDisplay from "@/components/shared/CentavosDisplay";

function pesosToCentavos(pesosStr) {
  const cleaned = (pesosStr || "").toString().replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (_e) {
    return iso || "";
  }
}

export default function RestockItemDrawer({ open, onClose, storeId, settings, product, monthlySold = 0, onQueued }) {
  const [restockQty, setRestockQty] = useState("");
  const [newCostPesos, setNewCostPesos] = useState("");
  const [note, setNote] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinProof, setPinProof] = useState(null);

  const productId = product?.id;

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ["stock-ledger-restock", storeId, productId],
    enabled: !!open && !!storeId && !!productId,
    queryFn: async () => {
      if (!navigator.onLine) return [];
      const res = await invokeFunction("listStockLedger", {
        store_id: storeId,
        product_id: productId,
        reason: "restock",
        limit: 30,
      });
      return res?.data?.rows || [];
    },
  });

  const { data: queuedLocal = [] } = useQuery({
    queryKey: ["queued-restocks", storeId, productId],
    enabled: !!open && !!storeId && !!productId,
    queryFn: async () => {
      const rows = await listOfflineQueue(storeId);
      return rows
        .filter((r) => r.event_type === "restockProduct")
        .map((r) => {
          try {
            return { ...r, payload: JSON.parse(r.payload_json || "{}") };
          } catch (_e) {
            return { ...r, payload: {} };
          }
        })
        .filter((r) => r.payload?.product_id === productId)
        .sort((a, b) => (b.created_at_device || 0) - (a.created_at_device || 0))
        .slice(0, 10);
    },
  });

  const currentQty = Number(product?.stock_quantity ?? product?.stock_qty ?? 0);
  const currentCost = Number(product?.cost_price_centavos ?? 0);

  const preview = useMemo(() => {
    const qty = Number(restockQty || 0);
    const newQty = currentQty + (Number.isFinite(qty) ? qty : 0);
    const costC = pesosToCentavos(newCostPesos);
    return { qty, newQty, costC };
  }, [restockQty, newCostPesos, currentQty]);

  const canSave = useMemo(() => {
    const qty = Number(restockQty || 0);
    const costC = pesosToCentavos(newCostPesos);
    const qtyOk = Number.isFinite(qty) && qty >= 0;
    const costOk = newCostPesos === "" || costC !== null;
    return qtyOk && costOk && (qty > 0 || costC !== null);
  }, [restockQty, newCostPesos]);

  const doQueue = async (owner_pin_proof) => {
    const event_id = generateEventId();
    const restock_id = event_id;
    const qty = Number(restockQty || 0);
    const costC = pesosToCentavos(newCostPesos);

    const payload = {
      store_id: storeId,
      product_id: productId,
      restock_id,
      restock_qty: qty,
      new_cost_centavos: costC,
      device_id: getDeviceId(),
      owner_pin_proof: owner_pin_proof || null,
      note: note || "",
    };

    await enqueueOfflineEvent({
      store_id: storeId,
      device_id: getDeviceId(),
      event_id,
      event_type: "restockProduct",
      payload,
      created_at_device: Date.now(),
    });

    // Optimistic cache patch (so it becomes immediately visible offline)
    const patched = {
      ...(product || {}),
      stock_quantity: preview.newQty,
      stock_qty: preview.newQty,
      cost_price_centavos: costC !== null ? costC : currentCost,
    };
    await patchCachedProductSnapshot(storeId, productId, patched);

    toast.success("Restock queued.");
    setRestockQty("");
    setNewCostPesos("");
    setNote("");
    onQueued?.();
    onClose?.();
  };

  const handleSave = async () => {
    if (!storeId || !productId) return;
    if (!canSave) {
      toast.error("Please enter restock qty or new cost.");
      return;
    }

    // If PIN required, ask. Proof equals storedHash after local verify.
    if (settings?.pin_required_stock_adjust && settings?.owner_pin_hash && !pinProof) {
      setPinOpen(true);
      return;
    }
    await doQueue(pinProof);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose?.()}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between">
              <span>Restock</span>
              <span className="text-xs font-normal text-stone-500">Monthly sold: {monthlySold}</span>
            </SheetTitle>
          </SheetHeader>

          {product ? (
            <div className="mt-4 space-y-4">
              <div className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900 truncate">{product.name}</p>
                    <p className="text-xs text-stone-500">Barcode: {product.barcode || "—"}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-stone-500">Current stock</div>
                    <div className="text-lg font-bold text-stone-900">{currentQty}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-stone-500">Current cost</div>
                  <CentavosDisplay centavos={currentCost} size="sm" className="text-stone-700" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Restock qty (+)</Label>
                  <Input
                    value={restockQty}
                    onChange={(e) => setRestockQty(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    placeholder="0"
                    className="h-11"
                  />
                  <p className="text-[11px] text-stone-500 mt-1">New stock: <span className="font-semibold text-stone-700">{preview.newQty}</span></p>
                </div>
                <div>
                  <Label className="text-xs">New cost (₱)</Label>
                  <Input
                    value={newCostPesos}
                    onChange={(e) => setNewCostPesos(e.target.value)}
                    inputMode="decimal"
                    placeholder="Optional"
                    className="h-11"
                  />
                  <p className="text-[11px] text-stone-500 mt-1">Leave blank to keep current</p>
                </div>
              </div>

              <div>
                <Label className="text-xs">Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier: ABC" className="h-11" />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-12" onClick={onClose}>Cancel</Button>
                <Button className="flex-1 h-12 bg-blue-600 hover:bg-blue-700" onClick={handleSave}>
                  Queue Restock
                </Button>
              </div>

              <Separator />

              <div>
                <p className="font-semibold text-stone-800 text-sm mb-2">History (Restocks)</p>
                {historyLoading ? (
                  <p className="text-sm text-stone-400">Loading…</p>
                ) : history.length === 0 ? (
                  <p className="text-sm text-stone-400">No restock history yet.</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((h) => (
                      <div key={h.id} className="bg-white border border-stone-100 rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-stone-800">+{Number(h.restock_qty ?? h.qty_delta ?? 0)}</div>
                          <div className="text-[11px] text-stone-500">{formatDate(h.created_at || h.created_date)}</div>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-stone-600">
                          <div>Qty: {Number(h.prev_qty ?? "—")} → <span className="font-semibold">{Number(h.resulting_qty ?? "—")}</span></div>
                          <div className="text-right">
                            Cost: <span className="text-stone-500">₱{((Number(h.prev_cost_centavos ?? currentCost) || 0) / 100).toFixed(2)}</span>
                            {" "}→ <span className="font-semibold">₱{((Number(h.new_cost_centavos ?? currentCost) || 0) / 100).toFixed(2)}</span>
                          </div>
                        </div>
                        {h.note ? <div className="mt-1 text-[11px] text-stone-500">{h.note}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {queuedLocal.length > 0 ? (
                <>
                  <Separator />
                  <div>
                    <p className="font-semibold text-stone-800 text-sm mb-2">Queued (Offline)</p>
                    <div className="space-y-2">
                      {queuedLocal.map((q) => (
                        <div key={q.event_id} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-amber-800">+{Number(q.payload?.restock_qty || 0)}</div>
                            <div className="text-[11px] text-amber-700">{q.status}</div>
                          </div>
                          <div className="mt-1 text-[11px] text-amber-800">
                            {new Date(q.created_at_device).toLocaleString()} • New cost: {q.payload?.new_cost_centavos ? `₱${(Number(q.payload.new_cost_centavos)/100).toFixed(2)}` : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="py-8 text-center text-stone-400">No product selected.</div>
          )}
        </SheetContent>
      </Sheet>

      <OwnerPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        storedHash={settings?.owner_pin_hash}
        actorEmail={null}
        actionContext={`Restock: ${product?.name || "item"}`}
        onApproved={({ owner_pin_proof }) => {
          setPinOpen(false);
          setPinProof(owner_pin_proof || null);
          // continue queue after PIN
          doQueue(owner_pin_proof || null);
        }}
      />
    </>
  );
}
