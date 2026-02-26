import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import OwnerPinModal from "@/components/global/OwnerPinModal";

import { enqueueOfflineEvent, patchCachedProductSnapshot } from "@/lib/db";
import { generateEventId, getDeviceId, normalizeBarcode } from "@/components/lib/deviceId";

function csvEscape(v) {
  const s = (v ?? "").toString();
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCsv(text) {
  const lines = (text || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    rows.push(obj);
  }
  return { headers, rows };
}

export default function CsvRestockCard({ storeId, settings, products }) {
  const fileRef = useRef(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinProof, setPinProof] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);

  const productById = useMemo(() => {
    const m = new Map();
    (products || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const productByBarcode = useMemo(() => {
    const m = new Map();
    (products || []).forEach((p) => {
      const bc = normalizeBarcode(p.barcode || "");
      if (bc) m.set(bc, p);
    });
    return m;
  }, [products]);

  const downloadSheet = () => {
    if (!products || products.length === 0) {
      toast.error("No products to export.");
      return;
    }
    const headers = [
      "product_id",
      "barcode",
      "name",
      "current_stock_quantity",
      "cost_price_centavos",
      "restock_qty",
      "new_cost_centavos",
      "new_stock_quantity",
    ];

    const lines = [headers.join(",")];
    for (const p of products) {
      const current = Number(p.stock_quantity ?? p.stock_qty ?? 0);
      const cost = Number(p.cost_price_centavos ?? 0);
      lines.push(
        headers
          .map((h) => {
            if (h === "product_id") return csvEscape(p.id);
            if (h === "barcode") return csvEscape(p.barcode || "");
            if (h === "name") return csvEscape(p.name || "");
            if (h === "current_stock_quantity") return String(current);
            if (h === "cost_price_centavos") return String(cost);
            return ""; // restock fields left empty
          })
          .join(",")
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `posync_inventory_${storeId}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded inventory sheet.");
  };

  const handleFilePick = () => {
    fileRef.current?.click();
  };

  const handleFile = async (file) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    const rows = [];
    for (const r of parsed.rows) {
      const pid = (r.product_id || "").trim();
      const bc = normalizeBarcode(r.barcode || "");
      const p = pid ? productById.get(pid) : bc ? productByBarcode.get(bc) : null;
      if (!p) {
        rows.push({ ok: false, reason: "Product not found", raw: r, product: null });
        continue;
      }
      const current = Number(p.stock_quantity ?? p.stock_qty ?? 0);

      const restockQty = Number((r.restock_qty || "").trim() || 0);
      const newStockQty = (r.new_stock_quantity || "").trim() ? Number(r.new_stock_quantity) : null;
      let delta = restockQty;
      if (newStockQty !== null && Number.isFinite(newStockQty)) {
        delta = newStockQty - current;
      }

      const newCost = (r.new_cost_centavos || "").trim() ? Number(r.new_cost_centavos) : null;
      const costOk = newCost === null || (Number.isFinite(newCost) && newCost >= 0);
      const deltaOk = Number.isFinite(delta) && delta >= 0;

      const actionable = (delta > 0) || (newCost !== null && newCost !== Number(p.cost_price_centavos ?? 0));

      rows.push({
        ok: !!p && costOk && deltaOk,
        actionable,
        product: p,
        delta,
        newCost,
        current,
        raw: r,
        reason: !deltaOk ? "Negative/invalid restock qty" : !costOk ? "Invalid new cost" : "",
      });
    }

    setParsedRows(rows);
    setSheetOpen(true);
  };

  const queueBatch = async (owner_pin_proof) => {
    if (!navigator.onLine) {
      toast.error("Offline — connect to internet to import restock.");
      return;
    }
    const device_id = getDeviceId();
    const actionable = parsedRows.filter((r) => r.ok && r.actionable);
    if (actionable.length === 0) {
      toast.warning("Nothing to import.");
      setSheetOpen(false);
      return;
    }

    for (const row of actionable) {
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
          product_id: row.product.id,
          restock_id,
          restock_qty: row.delta,
          new_cost_centavos: row.newCost,
          device_id,
          owner_pin_proof: owner_pin_proof || null,
          note: "CSV import",
        },
      });

      // optimistic cache update
      const patched = {
        ...(row.product || {}),
        stock_quantity: row.current + row.delta,
        stock_qty: row.current + row.delta,
        cost_price_centavos: row.newCost !== null ? row.newCost : Number(row.product.cost_price_centavos ?? 0),
      };
      await patchCachedProductSnapshot(storeId, row.product.id, patched);
    }

    toast.success(`Queued ${actionable.length} restock updates.`);
    setSheetOpen(false);
  };

  const applyImport = async () => {
    // If PIN is required and set, ask once for batch.
    if (settings?.pin_required_stock_adjust && settings?.owner_pin_hash && !pinProof) {
      setPinOpen(true);
      return;
    }
    await queueBatch(pinProof);
  };

  return (
    <>
      <Card className="border-stone-100 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Restock using CSV File</CardTitle>
          <p className="text-xs text-stone-500">Download your current inventory, update stocks, then import.</p>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="outline" className="flex-1 h-11" onClick={downloadSheet}>
            Download Sheet
          </Button>
          <Button className="flex-1 h-11 bg-blue-600 hover:bg-blue-700" onClick={handleFilePick}>
            Update New Stocks
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={(v) => !v && setSheetOpen(false)}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>CSV Preview</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {parsedRows.length === 0 ? (
              <p className="text-sm text-stone-400">No rows parsed.</p>
            ) : (
              parsedRows.map((r, idx) => {
                const name = r.product?.name || r.raw?.name || "(unknown)";
                return (
                  <div key={idx} className={`rounded-xl border p-3 ${r.ok ? "border-stone-100" : "border-red-200 bg-red-50"}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-800 truncate">{name}</p>
                        <p className="text-[11px] text-stone-500">{r.product?.barcode || ""}</p>
                      </div>
                      {r.ok ? (
                        <div className="text-right text-xs text-stone-600">
                          <div>+{r.delta}</div>
                          <div>{r.newCost !== null ? `₱${(r.newCost / 100).toFixed(2)}` : "—"}</div>
                        </div>
                      ) : (
                        <div className="text-xs text-red-700 font-medium">{r.reason || r.reason === "" ? r.reason : "Invalid"}</div>
                      )}
                    </div>
                    {r.ok && !r.actionable ? (
                      <p className="mt-1 text-[11px] text-stone-500">No changes detected.</p>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1 h-12" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1 h-12 bg-blue-600 hover:bg-blue-700" onClick={applyImport}>
              Import Selected
            </Button>
          </div>

          <div className="mt-3 text-[11px] text-stone-500">
            Tip: Use <span className="font-semibold">restock_qty</span> to add stock, or <span className="font-semibold">new_stock_quantity</span> to set the target stock.
          </div>
        </SheetContent>
      </Sheet>

      <OwnerPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        storedHash={settings?.owner_pin_hash}
        actorEmail={null}
        actionContext="CSV Restock Import"
        onApproved={({ owner_pin_proof }) => {
          setPinOpen(false);
          setPinProof(owner_pin_proof || null);
          queueBatch(owner_pin_proof || null);
        }}
      />
    </>
  );
}
