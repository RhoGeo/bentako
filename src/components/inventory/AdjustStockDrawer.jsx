import React, { useCallback, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import BarcodeScannerModal from "@/components/global/BarcodeScannerModal";
import OwnerPinModal from "@/components/global/OwnerPinModal";
import WedgeScannerInput from "@/components/counter/WedgeScannerInput";
import { can } from "@/components/lib/permissions";
import { getStockQty } from "@/components/inventory/inventoryRules";

import {
  enqueueOfflineEvent,
  getCachedProductByBarcode,
  patchCachedProductSnapshot,
} from "@/lib/db";
import {
  generateEventId,
  getDeviceId,
  normalizeBarcode,
} from "@/lib/ids/deviceId";
import { syncNow } from "@/components/lib/syncManager";

const REASONS = [
  "restock",
  "damaged",
  "expired",
  "lost",
  "cycle_count",
  "manual_correction",
  "return_from_customer",
  "return_to_supplier",
];

function toInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

export default function AdjustStockDrawer({
  open,
  storeId,
  products = [],
  settings,
  staffMember,
  user,
  onClose,
}) {
  const [searchValue, setSearchValue] = useState("");
  const [autoAddOnEnter, setAutoAddOnEnter] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const [deltaMode, setDeltaMode] = useState("add"); // add | remove
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");

  const [pinOpen, setPinOpen] = useState(false);
  const [pendingPinArgs, setPendingPinArgs] = useState(null);

  const sellable = useMemo(
    () => (products || []).filter((p) => p?.product_type !== "parent" && p?.is_active !== false),
    [products]
  );

  const suggestions = useMemo(() => {
    const q = (searchValue || "").trim().toLowerCase();
    if (!q) return [];
    const byName = sellable
      .filter((p) => (p?.name || "").toString().toLowerCase().includes(q))
      .slice(0, 8);
    return byName;
  }, [sellable, searchValue]);

  const currentQty = selected ? getStockQty(selected) : 0;
  const deltaAbs = Math.max(0, toInt(amount));
  const deltaQty = deltaMode === "remove" ? -deltaAbs : deltaAbs;
  const previewQty = selected ? currentQty + deltaQty : 0;

  const needsOwnerPin = useMemo(() => {
    if (!selected) return false;
    const hasPerm = can(staffMember, "inventory_adjust_stock");
    const requirePin = !!settings?.pin_required_stock_adjust;
    return !hasPerm && requirePin;
  }, [selected, staffMember, settings]);

  const findByBarcode = useCallback(
    async (barcode) => {
      if (!storeId) return null;
      const normalized = normalizeBarcode(barcode);

      const cached = await getCachedProductByBarcode(storeId, normalized);
      if (cached) return cached;

      const inMem = sellable.find((p) => normalizeBarcode(p?.barcode || "") === normalized);
      return inMem || null;
    },
    [storeId, sellable]
  );

  const selectProduct = (p) => {
    setSelected(p);
    setSearchValue(p?.name || p?.barcode || "");
  };

  const handleEnterSubmit = useCallback(
    async (value) => {
      const p = await findByBarcode(value);
      if (p) {
        if (autoAddOnEnter) {
          selectProduct(p);
          return;
        }
        setSearchValue(p?.name || value);
        return;
      }
      toast.warning("Barcode not found", { duration: 1400 });
    },
    [findByBarcode, autoAddOnEnter]
  );

  const queueAdjustment = useCallback(
    async ({ owner_pin_proof }) => {
      if (!storeId) return;
      if (!selected?.id) return;
      if (!reason) {
        toast.error("Piliin ang reason.");
        return;
      }
      if (!REASONS.includes(reason)) {
        toast.error("Invalid reason.");
        return;
      }
      if (deltaAbs <= 0) {
        toast.error("Ilagay ang quantity (>=1).");
        return;
      }

      const device_id = getDeviceId();
      const event_id = generateEventId();
      const adjustment_id = generateEventId();

      const payload = {
        store_id: storeId,
        product_id: selected.id,
        delta_qty: deltaQty,
        reason,
        adjustment_id,
        device_id,
        owner_pin_proof: owner_pin_proof ?? null,
      };

      await enqueueOfflineEvent({
        store_id: storeId,
        event_id,
        device_id,
        client_tx_id: null,
        event_type: "adjustStock",
        payload,
        created_at_device: Date.now(),
      });

      // Optimistic patch (offline-first): adjust local cached product stock
      const next = { ...selected };
      const nextQty = (Number(getStockQty(selected)) || 0) + Number(deltaQty);
      next.stock_quantity = nextQty;
      await patchCachedProductSnapshot(storeId, selected.id, next);

      toast.success("Stock adjustment queued.", { duration: 1600 });

      if (navigator.onLine) {
        syncNow(storeId).catch(() => {});
      }

      // reset
      setReason("");
      setAmount("1");
      setDeltaMode("add");
      setSelected(null);
      setSearchValue("");
      onClose?.();
    },
    [storeId, selected, reason, deltaAbs, deltaQty, onClose]
  );

  const handleSubmit = async () => {
    if (!selected) {
      toast.error("Pumili muna ng item.");
      return;
    }
    if (!reason) {
      toast.error("Piliin ang reason.");
      return;
    }
    if (deltaAbs <= 0) {
      toast.error("Ilagay ang quantity (>=1).");
      return;
    }

    if (needsOwnerPin) {
      setPendingPinArgs({});
      setPinOpen(true);
      return;
    }
    await queueAdjustment({ owner_pin_proof: null });
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose?.();
        }}
      >
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto p-0">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-stone-100">
            <SheetTitle className="text-lg">Adjust Stock</SheetTitle>
          </SheetHeader>

          <div className="px-5 py-4 space-y-5">
            {/* Product picker */}
            <div>
              <Label className="text-xs text-stone-500 mb-2 block">Item (barcode or name)</Label>
              <WedgeScannerInput
                value={searchValue}
                onChange={setSearchValue}
                onEnterSubmit={handleEnterSubmit}
                autoAddOnEnter={autoAddOnEnter}
                setAutoAddOnEnter={setAutoAddOnEnter}
                onScanIconClick={() => setScannerOpen(true)}
                placeholder="Scan / type barcode…"
              />
              {suggestions.length > 0 && !selected && (
                <div className="mt-2 rounded-xl border border-stone-100 bg-white overflow-hidden">
                  {suggestions.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => selectProduct(p)}
                      className="w-full text-left px-4 py-3 border-b last:border-b-0 border-stone-100 hover:bg-stone-50 active:bg-stone-100"
                    >
                      <div className="text-sm font-semibold text-stone-800">{p.name}</div>
                      <div className="text-[11px] text-stone-500">{p.barcode || "No barcode"}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected */}
            {selected && (
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-stone-800">{selected.name}</div>
                    <div className="text-[11px] text-stone-500">{selected.barcode || "No barcode"}</div>
                  </div>
                  <Button variant="outline" className="h-9" onClick={() => setSelected(null)}>
                    Change
                  </Button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white border border-stone-100 p-3 text-center">
                    <div className="text-[11px] text-stone-500">Current</div>
                    <div className="text-xl font-bold text-stone-800">{currentQty}</div>
                  </div>
                  <div className="rounded-lg bg-white border border-stone-100 p-3 text-center">
                    <div className="text-[11px] text-stone-500">After</div>
                    <div className={`text-xl font-bold ${previewQty < 0 ? "text-red-700" : "text-stone-800"}`}>{previewQty}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Delta */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDeltaMode("add")}
                className={`h-12 rounded-xl text-sm font-semibold transition-all touch-target ${
                  deltaMode === "add" ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"
                }`}
              >
                Add
              </button>
              <button
                onClick={() => setDeltaMode("remove")}
                className={`h-12 rounded-xl text-sm font-semibold transition-all touch-target ${
                  deltaMode === "remove" ? "bg-red-600 text-white" : "bg-stone-100 text-stone-700"
                }`}
              >
                Remove
              </button>
            </div>

            <div>
              <Label className="text-xs text-stone-500 mb-2 block">Quantity</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-14 text-2xl text-center font-bold bg-white"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {[1, 5, 10, 20].map((q) => (
                  <button
                    key={q}
                    onClick={() => setAmount(String(q))}
                    className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 active:scale-95 transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Reason */}
            <div>
              <Label className="text-xs text-stone-500 mb-2 block">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Choose reason" />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {needsOwnerPin && (
                <p className="mt-2 text-[11px] text-amber-700">
                  Requires Owner PIN (staff role: {staffMember?.role || "unknown"}).
                </p>
              )}
            </div>

            <Button
              className={`w-full h-14 text-base font-bold touch-target safe-bottom ${
                deltaMode === "remove" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
              } text-white`}
              onClick={handleSubmit}
              disabled={!storeId}
            >
              Queue Adjustment
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Scanner (single scan) */}
      <BarcodeScannerModal
        open={scannerOpen}
        mode="single"
        context="items"
        onLookup={async (barcode) => {
          const p = await findByBarcode(barcode);
          if (p) {
            selectProduct(p);
            return { found: true, handled: true, label: p.name };
          }
          return { found: false };
        }}
        onNotFound={() => toast.warning("Barcode not found", { duration: 1500 })}
        onClose={() => setScannerOpen(false)}
      />

      {/* Owner PIN */}
      <OwnerPinModal
        open={pinOpen}
        onClose={() => {
          setPinOpen(false);
          setPendingPinArgs(null);
        }}
        storedHash={settings?.owner_pin_hash || null}
        actorEmail={user?.email || ""}
        actionContext="Adjust Stock"
        onApproved={async ({ owner_pin_proof }) => {
          setPinOpen(false);
          setPendingPinArgs(null);
          await queueAdjustment({ owner_pin_proof });
        }}
      />
    </>
  );
}
