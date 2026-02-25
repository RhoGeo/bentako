import React, { useEffect, useMemo, useState } from "react";
import { invokeFunction } from "@/api/posyncClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, ScanLine, Trash2, Plus, Save } from "lucide-react";
import BarcodeScannerModal from "@/components/global/BarcodeScannerModal";
import { normalizeBarcode } from "@/lib/ids/deviceId";
import { getCachedProductByBarcode, upsertCachedProducts } from "@/lib/db";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { auditLog } from "@/components/lib/auditLog";

const CATEGORIES = ["Drinks", "Snacks", "Canned", "Hygiene", "Rice", "Condiments", "Frozen", "Others"];

function pesoToCentavos(pesoVal) {
  const n = Number.parseFloat(String(pesoVal || "").trim() || "0");
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export default function ProductForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useActiveStoreId();
  const { user } = useCurrentStaff(storeId);

  const urlParams = new URLSearchParams(window.location.search);
  const productIdFromUrl = urlParams.get("id");
  const prefillBarcode = urlParams.get("barcode") || "";

  const [resolvedEditId, setResolvedEditId] = useState(productIdFromUrl || null);

  const [form, setForm] = useState({
    name: "",
    category: "",
    product_type: "single", // 'single'|'parent'
    barcode: prefillBarcode,
    cost_price_centavos: 0,
    selling_price_centavos: 0,
    track_stock: false,
    stock_qty: 0,
    low_stock_threshold: 5,
    is_pinned: false,
    store_id: storeId,
  });

  const [variants, setVariants] = useState([]);
  const [scanTarget, setScanTarget] = useState(null); // null | "main" | number index
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // ── Load product context ────────────────────────────────────────────────
  const { data: ctx, isLoading } = useQuery({
    queryKey: ["product-form", storeId, productIdFromUrl],
    enabled: !!storeId,
    queryFn: async () => {
      if (!productIdFromUrl) return { product: null, variants: [], resolvedProductId: null };

      const pRes = await invokeFunction("getProduct", { store_id: storeId, product_id: productIdFromUrl });
      const product = pRes?.data?.product || null;
      if (!product) return { product: null, variants: [], resolvedProductId: null };

      // If a variant was tapped from Items/Counter, open its parent editor (variants managed there).
      if (product.parent_id) {
        const parentId = product.parent_id;
        const parentRes = await invokeFunction("getProduct", { store_id: storeId, product_id: parentId });
        const parent = parentRes?.data?.product || null;
        const vRes = await invokeFunction("listProductVariants", { store_id: storeId, parent_product_id: parentId });
        const vars = vRes?.data?.variants || [];
        return { product: parent, variants: vars, resolvedProductId: parentId };
      }

      if (product.product_type === "parent") {
        const vRes = await invokeFunction("listProductVariants", { store_id: storeId, parent_product_id: product.id });
        const vars = vRes?.data?.variants || [];
        return { product, variants: vars, resolvedProductId: product.id };
      }

      return { product, variants: [], resolvedProductId: product.id };
    },
    staleTime: 20_000,
  });

  useEffect(() => {
    // Reset store binding in form when switching store
    setForm((f) => ({ ...f, store_id: storeId }));
  }, [storeId]);

  useEffect(() => {
    if (!ctx) return;

    setResolvedEditId(ctx.resolvedProductId);

    // New product
    if (!ctx.product) {
      setForm((f) => ({
        ...f,
        name: "",
        category: "",
        product_type: "single",
        barcode: prefillBarcode,
        cost_price_centavos: 0,
        selling_price_centavos: 0,
        track_stock: false,
        stock_qty: 0,
        low_stock_threshold: 5,
        is_pinned: false,
        store_id: storeId,
      }));
      setVariants([]);
      return;
    }

    // Edit (single or parent)
    const p = ctx.product;
    setForm({
      name: p.name || "",
      category: p.category || "",
      product_type: p.product_type || "single",
      barcode: p.barcode || "",
      cost_price_centavos: p.cost_price_centavos || 0,
      selling_price_centavos: p.selling_price_centavos || 0,
      track_stock: !!p.track_stock,
      stock_qty: p.stock_qty || 0,
      low_stock_threshold: p.low_stock_threshold ?? 5,
      is_pinned: !!p.is_pinned,
      store_id: storeId,
    });

    if ((p.product_type || "single") === "parent") {
      const vars = (ctx.variants || []).map((v) => ({
        id: v.id,
        name: v.variant_name || v.name || "",
        cost_price_centavos: v.cost_price_centavos || 0,
        selling_price_centavos: v.selling_price_centavos || 0,
        track_stock: !!v.track_stock,
        stock_qty: v.stock_qty || 0,
        low_stock_threshold: v.low_stock_threshold ?? 0,
        barcode: v.barcode || "",
      }));
      setVariants(vars);
    } else {
      setVariants([]);
    }
  }, [ctx, prefillBarcode, storeId]);

  const isEdit = !!resolvedEditId;
  const isParent = form.product_type === "parent";

  // ── Barcode conflicts (Dexie-first) ─────────────────────────────────────
  const findBarcodeConflict = async ({ barcode, excludeId }) => {
    if (!storeId) return null;
    const bc = normalizeBarcode(barcode);
    if (!bc) return null;

    const cached = await getCachedProductByBarcode(storeId, bc);
    if (cached && cached.product_type !== "parent" && cached.id && cached.id !== excludeId) return cached;

    if (!navigator.onLine) return null;

    try {
      const res = await invokeFunction("barcodeLookup", { store_id: storeId, barcode: bc });
      const p = res?.data?.product || null;
      if (p && p.id && p.id !== excludeId) return p;
    } catch (_e) {}

    return null;
  };

  const validationErrors = useMemo(() => {
    const errs = [];
    if (!form.name.trim()) errs.push("Name is required");

    if (!isParent) {
      if (!form.cost_price_centavos || form.cost_price_centavos <= 0) errs.push("Cost is required");
    } else {
      if (variants.length === 0) errs.push("Add at least 1 variant");
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!String(v.name || "").trim()) errs.push(`Variant ${i + 1}: name required`);
        if (!v.cost_price_centavos || v.cost_price_centavos <= 0) errs.push(`Variant ${i + 1}: cost required`);
      }
    }

    return errs;
  }, [form.name, form.cost_price_centavos, isParent, variants]);

  const handleSave = async () => {
    if (validationErrors.length) {
      toast.error(validationErrors[0]);
      return;
    }

    setSaving(true);

    const data = {
      ...form,
      store_id: storeId,
      id: resolvedEditId || undefined,
      barcode: normalizeBarcode(form.barcode),
      cost_price_centavos: Math.round(form.cost_price_centavos || 0),
      selling_price_centavos: Math.round(form.selling_price_centavos || 0),
      stock_qty: Number(form.stock_qty || 0),
    };

    // Parent: clear sellable fields
    if (isParent) {
      data.barcode = "";
      data.selling_price_centavos = 0;
      data.cost_price_centavos = 0;
      data.track_stock = false;
      data.stock_qty = 0;
    }

    // Barcode uniqueness per store (sellable only)
    const barcodesToCheck = [];
    if (!isParent && data.barcode) barcodesToCheck.push({ id: resolvedEditId || null, barcode: data.barcode });
    if (isParent) {
      for (const v of variants) {
        const bc = normalizeBarcode(v.barcode);
        if (bc) barcodesToCheck.push({ id: v.id || null, barcode: bc });
      }
    }

    // In-form duplicates
    const seen = new Set();
    for (const b of barcodesToCheck) {
      if (seen.has(b.barcode)) {
        toast.error(`Duplicate barcode in form: ${b.barcode}`);
        setSaving(false);
        return;
      }
      seen.add(b.barcode);
    }

    // Confirm against existing (Dexie + server)
    for (const b of barcodesToCheck) {
      const conflict = await findBarcodeConflict({ barcode: b.barcode, excludeId: b.id || null });
      if (conflict) {
        toast.error(`Barcode already used in this store: ${b.barcode}`);
        setSaving(false);
        return;
      }
    }

    const variantsPayload = isParent
      ? variants.map((v) => ({
          id: v.id || undefined,
          name: String(v.name || "").trim(),
          barcode: normalizeBarcode(v.barcode),
          selling_price_centavos: Math.round(Number(v.selling_price_centavos || 0)),
          cost_price_centavos: Math.round(Number(v.cost_price_centavos || 0)),
          track_stock: !!v.track_stock,
          stock_qty: Number(v.stock_qty || 0),
          low_stock_threshold: Number(v.low_stock_threshold || 0),
        }))
      : [];

    try {
      const res = await invokeFunction("upsertProduct", {
        store_id: storeId,
        product: data,
        variants: variantsPayload,
      });

      const savedProductId = res?.data?.product_id || resolvedEditId;

      // Audit log
      await auditLog(isEdit ? "product_edited" : "product_created", isEdit ? "Product edited" : "Product created", {
        actor_email: user?.email,
        reference_id: savedProductId,
        metadata: { store_id: storeId, product_type: data.product_type },
      });

      // Update Dexie cache immediately (offline-first)
      const parentSnapshot = res?.data?.product;
      const variantSnapshots = res?.data?.variants || [];
      const toCache = [parentSnapshot, ...variantSnapshots].filter(Boolean);
      if (toCache.length) await upsertCachedProducts(toCache, storeId);

      queryClient.invalidateQueries({ queryKey: ["cached-products", storeId] });
      queryClient.invalidateQueries({ queryKey: ["products-all", storeId] });

      toast.success(isEdit ? "Product updated!" : "Product created!");
      navigate(createPageUrl("Items"));
    } catch (e) {
      const msg = e?.message || "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleScanResult = (barcode) => {
    if (scanTarget === "main") {
      updateField("barcode", barcode);
    } else if (typeof scanTarget === "number") {
      setVariants((prev) => prev.map((v, i) => (i === scanTarget ? { ...v, barcode } : v)));
    }
    setScannerOpen(false);
  };

  const addVariant = () => {
    setVariants((prev) => [
      ...prev,
      {
        name: "",
        cost_price_centavos: 0,
        selling_price_centavos: 0,
        track_stock: false,
        stock_qty: 0,
        low_stock_threshold: 0,
        barcode: "",
      },
    ]);
  };

  const removeVariant = (index) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVariant = (index, key, value) => {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [key]: value } : v)));
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target">
          <ArrowLeft className="w-5 h-5 text-stone-600" />
        </button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">
          {isEdit ? "Edit Product" : "New Product"}
        </h1>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 h-9 px-4 touch-target"
        >
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="px-4 py-5 space-y-6">
        {isLoading ? (
          <div className="text-center py-12 text-stone-400 text-sm">Loading…</div>
        ) : (
          <>
            {/* Type Selector */}
            <div>
              <Label className="text-xs text-stone-500 mb-2 block">Product Type</Label>
              <div className="flex gap-2">
                <button
                  onClick={() => updateField("product_type", "single")}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all touch-target ${
                    !isParent ? "bg-blue-600 text-white shadow-md" : "bg-stone-100 text-stone-600"
                  }`}
                >
                  Single Item
                </button>
                <button
                  onClick={() => updateField("product_type", "parent")}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all touch-target ${
                    isParent ? "bg-blue-600 text-white shadow-md" : "bg-stone-100 text-stone-600"
                  }`}
                >
                  Parent w/ Variants
                </button>
              </div>
            </div>

            {/* Core fields */}
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-stone-500 mb-1.5 block">Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g. Marlboro"
                  className="h-12 text-base"
                />
              </div>

              <div>
                <Label className="text-xs text-stone-500 mb-1.5 block">Category</Label>
                <Select value={form.category} onValueChange={(v) => updateField("category", v)}>
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Sellable fields (single only) */}
            {!isParent && (
              <div className="space-y-4 bg-stone-50 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-stone-500 mb-1.5 block">Cost (₱) *</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={form.cost_price_centavos ? form.cost_price_centavos / 100 : ""}
                      onChange={(e) => updateField("cost_price_centavos", pesoToCentavos(e.target.value))}
                      placeholder="0.00"
                      className="h-12 text-base font-semibold"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-500 mb-1.5 block">Price (₱)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={form.selling_price_centavos ? form.selling_price_centavos / 100 : ""}
                      onChange={(e) => updateField("selling_price_centavos", pesoToCentavos(e.target.value))}
                      placeholder="0.00"
                      className="h-12 text-base font-semibold"
                    />
                  </div>
                </div>

                {/* Barcode */}
                <div>
                  <Label className="text-xs text-stone-500 mb-1.5 block">Barcode</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.barcode}
                      onChange={(e) => updateField("barcode", e.target.value)}
                      placeholder="Scan or type barcode"
                      className="h-12 flex-1 font-mono"
                    />
                    <Button
                      variant="outline"
                      className="h-12 w-12 p-0 touch-target"
                      onClick={() => {
                        setScanTarget("main");
                        setScannerOpen(true);
                      }}
                    >
                      <ScanLine className="w-5 h-5 text-blue-600" />
                    </Button>
                  </div>
                </div>

                {/* Stock */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-stone-700">Track Stock</Label>
                  <Switch checked={form.track_stock} onCheckedChange={(v) => updateField("track_stock", v)} />
                </div>
                {form.track_stock && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-stone-500 mb-1.5 block">Stock Qty</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={form.stock_qty || ""}
                        onChange={(e) => updateField("stock_qty", parseInt(e.target.value || "0"))}
                        className="h-12 text-base"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-stone-500 mb-1.5 block">Low Threshold</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={form.low_stock_threshold || ""}
                        onChange={(e) => updateField("low_stock_threshold", parseInt(e.target.value || "0"))}
                        className="h-12 text-base"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Variants Section */}
            {isParent && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold text-stone-700">Variants</Label>
                  <Button variant="outline" size="sm" onClick={addVariant} className="h-8 touch-target">
                    <Plus className="w-3 h-3 mr-1" /> Add Variant
                  </Button>
                </div>

                {variants.map((v, i) => (
                  <div key={v.id || i} className="bg-stone-50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-stone-500">Variant {i + 1}</span>
                      <button onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <Input
                      value={v.name}
                      onChange={(e) => updateVariant(i, "name", e.target.value)}
                      placeholder="Variant name (e.g. Red)"
                      className="h-11"
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] text-stone-400">Cost (₱) *</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={v.cost_price_centavos ? v.cost_price_centavos / 100 : ""}
                          onChange={(e) => updateVariant(i, "cost_price_centavos", pesoToCentavos(e.target.value))}
                          className="h-10"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-stone-400">Price (₱)</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={v.selling_price_centavos ? v.selling_price_centavos / 100 : ""}
                          onChange={(e) => updateVariant(i, "selling_price_centavos", pesoToCentavos(e.target.value))}
                          className="h-10"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-[10px] text-stone-400">Barcode</Label>
                      <div className="flex gap-1">
                        <Input
                          value={v.barcode}
                          onChange={(e) => updateVariant(i, "barcode", e.target.value)}
                          className="h-10 font-mono flex-1"
                        />
                        <Button
                          variant="outline"
                          className="h-10 w-10 p-0"
                          onClick={() => {
                            setScanTarget(i);
                            setScannerOpen(true);
                          }}
                        >
                          <ScanLine className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-stone-500">Track Stock</span>
                      <Switch checked={v.track_stock} onCheckedChange={(val) => updateVariant(i, "track_stock", val)} />
                    </div>

                    {v.track_stock && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px] text-stone-400">Stock qty</Label>
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={v.stock_qty || ""}
                            onChange={(e) => updateVariant(i, "stock_qty", parseInt(e.target.value || "0"))}
                            className="h-10"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-stone-400">Low threshold</Label>
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={v.low_stock_threshold || ""}
                            onChange={(e) => updateVariant(i, "low_stock_threshold", parseInt(e.target.value || "0"))}
                            className="h-10"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {variants.length === 0 && (
                  <p className="text-xs text-stone-400 text-center py-4">No variants yet. Tap "Add Variant" to start.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Scanner */}
      <BarcodeScannerModal
        open={scannerOpen}
        mode="single"
        context="product_form"
        onFound={handleScanResult}
        onAddNew={() => setScannerOpen(false)}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
