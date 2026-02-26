import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { invokeFunction } from "@/api/posyncClient";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Package, PlusCircle } from "lucide-react";
import SubpageHeader from "@/components/layout/SubpageHeader";
import { toast } from "sonner";

import OwnerPinModal from "@/components/global/OwnerPinModal";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { enqueueOfflineEvent, patchCachedProductSnapshot, upsertCachedProducts, getAllCachedProducts } from "@/lib/db";
import { generateEventId, getDeviceId } from "@/lib/ids/deviceId";
import { getEffectiveThresholds, getInventoryTag, getStockQty, normalizeForMatch } from "@/components/inventory/inventoryRules";

function pesosToCentavos(pesosStr) {
  const cleaned = (pesosStr || "").toString().replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function pesoFmt(centavos) {
  return `₱${(Number(centavos || 0) / 100).toFixed(2)}`;
}

export default function RestockChecklist() {
  const navigate = useNavigate();
  const { storeId } = useActiveStoreId();
  const { settings } = useStoreSettings(storeId);

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode"); // critical | low_critical | all_stocked

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinProof, setPinProof] = useState(null);
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [search, setSearch] = useState("");

  const [form, setForm] = useState(() => ({}));

  const { data: productsServer = [] } = useQuery({
    queryKey: ["products-all", storeId],
    enabled: !!storeId && navigator.onLine,
    queryFn: async () => {
      const res = await invokeFunction("listProducts", { store_id: storeId, include_parents: true });
      const rows = res?.data?.products || [];
      await upsertCachedProducts(rows, storeId);
      return rows;
    },
    initialData: [],
  });

  const { data: productsOffline = [] } = useQuery({
    queryKey: ["products-offline", storeId],
    queryFn: async () => getAllCachedProducts(storeId),
    initialData: [],
  });

  const products = productsServer.length > 0 ? productsServer : productsOffline;

  const { data: metrics } = useQuery({
    queryKey: ["inventory-metrics", storeId],
    enabled: !!storeId && navigator.onLine,
    queryFn: async () => {
      const r = await invokeFunction("getInventoryMetrics", { store_id: storeId, window_days: 30 });
      return r?.data || r?.data?.data;
    },
    staleTime: 60_000,
  });

  const soldMap = metrics?.monthly_sold_by_product || {};

  const computed = useMemo(() => {
    const sellable = (products || []).filter((p) => p.product_type !== "parent");
    const withTag = sellable.map((p) => {
      const tag = getInventoryTag(p, settings);
      const qty = getStockQty(p);
      const thresholds = getEffectiveThresholds(p, settings);
      return {
        p,
        qty,
        tag: tag.tag,
        tagLabel: tag.label,
        thresholds,
        monthlySold: Number(soldMap[p.id] || 0),
        match: normalizeForMatch(p),
      };
    });

    const criticalOnly = withTag.filter((x) => x.p.track_stock && (x.tag === "critical" || x.tag === "out"));
    const lowCritical = withTag.filter((x) => x.p.track_stock && (x.tag === "low" || x.tag === "critical" || x.tag === "out"));
    const allStocked = withTag.filter((x) => x.p.track_stock);

    return {
      withTag,
      counts: {
        criticalOnly: criticalOnly.length,
        lowCritical: lowCritical.length,
        allStocked: allStocked.length,
      },
    };
  }, [products, settings, soldMap]);

  const filteredList = useMemo(() => {
    let list = computed.withTag;
    if (mode === "critical") {
      list = list.filter((x) => x.p.track_stock && (x.tag === "critical" || x.tag === "out"));
    } else if (mode === "low_critical") {
      list = list.filter((x) => x.p.track_stock && (x.tag === "low" || x.tag === "critical" || x.tag === "out"));
    } else if (mode === "all_stocked") {
      list = list.filter((x) => x.p.track_stock);
    }

    list = list.filter((x) => !removedIds.has(x.p.id));

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((x) => x.match.name.includes(q) || x.match.category.includes(q) || (x.p.barcode || "").includes(search.trim()));
    }

    // Default order: most urgent first, then lowest qty
    const pri = { out: 0, critical: 1, low: 2, safe: 3 };
    list = list.slice().sort((a, b) => {
      const pa = pri[a.tag] ?? 9;
      const pb = pri[b.tag] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.qty - b.qty;
    });

    return list;
  }, [computed.withTag, mode, removedIds, search]);

  const start = () => setPickerOpen(true);

  const selectMode = (m) => {
    setPickerOpen(false);
    navigate(createPageUrl("RestockChecklist") + `?mode=${m}`);
  };

  const toggleSelected = (pid, checked) => {
    setForm((prev) => {
      const next = { ...prev };
      const existing = next[pid] || { restockQty: "", newCostPesos: "", costOpen: false };
      next[pid] = { ...existing, selected: checked };
      return next;
    });
  };

  const setField = (pid, patch) => {
    setForm((prev) => ({ ...prev, [pid]: { ...(prev[pid] || {}), ...patch } }));
  };

  const removeRow = (pid) => {
    setRemovedIds((s) => {
      const n = new Set(Array.from(s));
      n.add(pid);
      return n;
    });
  };

  const queueSelected = async (owner_pin_proof) => {
    if (!navigator.onLine) {
      toast.error("Offline — connect to internet to restock.");
      return;
    }
    const device_id = getDeviceId();
    const selectedIds = Object.keys(form).filter((pid) => form[pid]?.selected);
    if (selectedIds.length === 0) {
      toast.warning("No items selected.");
      return;
    }

    let queued = 0;
    for (const pid of selectedIds) {
      const row = form[pid];
      const item = computed.withTag.find((x) => x.p.id === pid)?.p;
      if (!item) continue;

      const currentQty = getStockQty(item);
      const qtyAdd = Number(row.restockQty || 0);
      const costC = pesosToCentavos(row.newCostPesos);
      const costChanged = costC !== null && costC !== Number(item.cost_price_centavos ?? 0);
      const actionable = (Number.isFinite(qtyAdd) && qtyAdd > 0) || costChanged;

      if (!actionable) continue;
      if (!Number.isFinite(qtyAdd) || qtyAdd < 0) continue;

      const event_id = generateEventId();
      const restock_id = event_id;

      await enqueueOfflineEvent({
        store_id: storeId,
        device_id,
        event_id,
        event_type: "restockProduct",
        created_at_device: Date.now(),
        payload: {
          store_id: storeId,
          product_id: pid,
          restock_id,
          restock_qty: qtyAdd,
          new_cost_centavos: costC,
          device_id,
          owner_pin_proof: owner_pin_proof || null,
          note: "Checklist restock",
        },
      });

      // optimistic cache patch
      const patched = {
        ...(item || {}),
        stock_quantity: currentQty + qtyAdd,
        stock_qty: currentQty + qtyAdd,
        cost_price_centavos: costC !== null ? costC : Number(item.cost_price_centavos ?? 0),
      };
      await patchCachedProductSnapshot(storeId, pid, patched);

      queued++;
    }

    if (queued === 0) {
      toast.warning("Nothing to import. Add qty or new cost.");
      return;
    }
    toast.success(`Queued ${queued} restock updates.`);
    navigate(createPageUrl("Items"));
  };

  const importNow = async () => {
    if (settings?.pin_required_stock_adjust && settings?.owner_pin_hash && !pinProof) {
      setPinOpen(true);
      return;
    }
    await queueSelected(pinProof);
  };

  return (
    <div className="pb-28">
      <SubpageHeader title="Restock Checklists" subtitle={mode ? "Select items to restock" : "Prepare a restock list"} />

      {!mode ? (
        <div className="px-4 py-5 space-y-3">
          <Card className="border-stone-100 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Start Restocking</CardTitle>
              <p className="text-xs text-stone-500">Choose which items to restock today.</p>
            </CardHeader>
            <CardContent>
              <Button className="w-full h-12 bg-blue-600 hover:bg-blue-700" onClick={start}>
                Start Restocking
              </Button>
            </CardContent>
          </Card>

          <Card className="border-stone-100 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quick counts</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <div className="text-xs text-red-700">Critical</div>
                <div className="text-xl font-bold text-red-800">{computed.counts.criticalOnly}</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <div className="text-xs text-amber-700">Low+Critical</div>
                <div className="text-xl font-bold text-amber-800">{computed.counts.lowCritical}</div>
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
                <div className="text-xs text-stone-600">All Stocked</div>
                <div className="text-xl font-bold text-stone-800">{computed.counts.allStocked}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-3">
          <div className="flex gap-2">
            <Input className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" />
            <Button variant="outline" className="h-11" onClick={() => setPickerOpen(true)}>
              Change
            </Button>
          </div>

          <div className="space-y-2">
            {filteredList.length === 0 ? (
              <div className="text-center py-12 text-stone-400 text-sm">
                No items.
              </div>
            ) : (
              filteredList.map((x) => {
                const p = x.p;
                const row = form[p.id] || { selected: false, restockQty: "", newCostPesos: "", costOpen: false };
                return (
                  <div key={p.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-stone-50 flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-stone-300" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-stone-900 truncate">{p.name}</p>
                            <p className="text-[11px] text-stone-500">Monthly sold: <span className="font-semibold">{x.monthlySold}</span></p>
                          </div>
                          <button onClick={() => removeRow(p.id)} className="touch-target text-stone-400 hover:text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-stone-600">
                          <div>Current stock: <span className="font-semibold">{x.qty}</span></div>
                          <div className="text-right">Prev cost: <span className="font-semibold">{pesoFmt(p.cost_price_centavos)}</span></div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="flex items-center gap-2">
                            <Checkbox checked={!!row.selected} onCheckedChange={(v) => toggleSelected(p.id, !!v)} />
                            <span className="text-xs text-stone-700">Select</span>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => setField(p.id, { costOpen: !row.costOpen })}
                            >
                              New cost
                            </Button>
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <Input
                              className="h-10"
                              inputMode="numeric"
                              placeholder="Restock qty (+)"
                              value={row.restockQty}
                              onChange={(e) => setField(p.id, { restockQty: e.target.value.replace(/[^0-9]/g, "") })}
                            />
                          </div>
                          <div>
                            {row.costOpen ? (
                              <Input
                                className="h-10"
                                inputMode="decimal"
                                placeholder="New cost (₱)"
                                value={row.newCostPesos}
                                onChange={(e) => setField(p.id, { newCostPesos: e.target.value })}
                              />
                            ) : (
                              <div className="h-10 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center text-xs text-stone-500">
                                Cost unchanged
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="fixed bottom-16 left-0 right-0 px-4">
            <Button className="w-full h-12 bg-blue-600 hover:bg-blue-700 shadow-lg" onClick={importNow}>
              <PlusCircle className="w-5 h-5 mr-2" /> Import (Selected Only)
            </Button>
          </div>
        </div>
      )}

      <Sheet open={pickerOpen} onOpenChange={(v) => !v && setPickerOpen(false)}>
        <SheetContent side="bottom" className="max-h-[70vh]">
          <SheetHeader>
            <SheetTitle>Select Checklist</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            <button onClick={() => selectMode("critical")} className="w-full text-left bg-white border border-stone-200 rounded-xl p-4 active:scale-[0.99]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-stone-800">Critical Items Only</p>
                  <p className="text-xs text-stone-500">Out of stock + critical levels</p>
                </div>
                <div className="text-lg font-bold text-red-600">{computed.counts.criticalOnly}</div>
              </div>
            </button>
            <button onClick={() => selectMode("low_critical")} className="w-full text-left bg-white border border-stone-200 rounded-xl p-4 active:scale-[0.99]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-stone-800">Low & Critical Items</p>
                  <p className="text-xs text-stone-500">Low + critical + out of stock</p>
                </div>
                <div className="text-lg font-bold text-amber-600">{computed.counts.lowCritical}</div>
              </div>
            </button>
            <button onClick={() => selectMode("all_stocked")} className="w-full text-left bg-white border border-stone-200 rounded-xl p-4 active:scale-[0.99]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-stone-800">All Stocked Items</p>
                  <p className="text-xs text-stone-500">All items that track stock</p>
                </div>
                <div className="text-lg font-bold text-stone-700">{computed.counts.allStocked}</div>
              </div>
            </button>
          </div>
          <div className="mt-4">
            <Button variant="outline" className="w-full h-12" onClick={() => setPickerOpen(false)}>Close</Button>
          </div>
        </SheetContent>
      </Sheet>

      <OwnerPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        storedHash={settings?.owner_pin_hash}
        actorEmail={null}
        actionContext="Checklist Restock Import"
        onApproved={({ owner_pin_proof }) => {
          setPinOpen(false);
          setPinProof(owner_pin_proof || null);
          queueSelected(owner_pin_proof || null);
        }}
      />
    </div>
  );
}
