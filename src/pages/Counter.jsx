/**
 * Counter — Primary sale screen.
 *
 * Parent/Variant UX:
 * - Standalone item (no variants): title = item.name
 * - Variant item: title = parent_name, subtitle = variant_name
 * - Parent container rows (product_type='parent') are not sellable and are excluded.
 *
 * Sale item fields stored in cart + payload:
 * - product_id: sellable row id (standalone or variant)
 * - parent_id: parent container id for variants; self id for standalone
 * - variant_id: variant product id for variants; null for standalone
 * - display_name: "Parent - Variant" or standalone name
 */
import React, { useMemo, useState, useCallback } from "react";
import { invokeFunction } from "@/api/posyncClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ScanLine } from "lucide-react";
import WedgeScannerInput from "@/components/counter/WedgeScannerInput";
import QuickProductGrid from "@/components/counter/QuickProductGrid";
import CartPanel from "@/components/counter/CartPanel";
import PaymentDrawer from "@/components/counter/PaymentDrawer";
import InventoryHealthCard from "@/components/counter/InventoryHealthCard";
import BarcodeScannerModal from "@/components/global/BarcodeScannerModal";
import AdjustStockDrawer from "@/components/inventory/AdjustStockDrawer";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  getCachedProductByBarcode,
  enqueueOfflineEvent,
  upsertLocalReceipt,
  getAllCachedProducts,
  getAllCachedCustomers,
} from "@/lib/db";
import {
  generateClientTxId,
  generateEventId,
  getDeviceId,
  normalizeBarcode,
} from "@/lib/ids/deviceId";
import { syncNow } from "@/components/lib/syncManager";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { getStockQty } from "@/components/inventory/inventoryRules";

function toCounterItem(p) {
  if (!p) return null;
  const isParent = p?.product_type === "parent";
  if (isParent) {
    // Parent rows are containers in the current DB model and not sellable.
    return {
      ...p,
      counter_title: p.name,
      counter_subtitle: "",
      display_name: p.name,
      parent_id_for_sale: p.id,
      variant_id_for_sale: null,
    };
  }

  const hasParent = !!p?.parent_id;
  const parentName = (p?.parent_name || "").toString().trim();
  const variantName = (p?.variant_name || "").toString().trim();

  if (hasParent) {
    const title = parentName || (p?.name || "").toString();
    const subtitle = variantName || (p?.name || "").toString();
    return {
      ...p,
      counter_title: title,
      counter_subtitle: subtitle,
      display_name: `${title} - ${subtitle}`.trim(),
      parent_id_for_sale: p.parent_id,
      variant_id_for_sale: p.id,
    };
  }

  const title = (p?.name || "").toString();
  return {
    ...p,
    counter_title: title,
    counter_subtitle: "",
    display_name: title,
    parent_id_for_sale: p.id,
    variant_id_for_sale: null,
  };
}

export default function Counter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId: STORE_ID } = useActiveStoreId();
  const { settings } = useStoreSettings(STORE_ID);
  const { staffMember } = useCurrentStaff(STORE_ID);

  const [searchValue, setSearchValue] = useState("");
  const [autoAddOnEnter, setAutoAddOnEnter] = useState(true);
  const [cart, setCart] = useState([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const {
    data: products = [],
    isLoading: productsLoading,
    error: productsErr,
  } = useQuery({
    queryKey: ["products", STORE_ID],
    enabled: !!STORE_ID,
    queryFn: async () => {
      const cached = await getAllCachedProducts(STORE_ID);
      if (cached?.length) return cached;
      if (navigator.onLine) {
        const res = await invokeFunction("listProducts", { store_id: STORE_ID });
        return res?.data?.products || res?.data?.data?.products || [];
      }
      return [];
    },
    staleTime: 30_000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", STORE_ID],
    enabled: !!STORE_ID,
    queryFn: async () => {
      const cached = await getAllCachedCustomers(STORE_ID);
      if (cached?.length) return cached;
      if (navigator.onLine) {
        const res = await invokeFunction("listCustomers", { store_id: STORE_ID });
        return res?.data?.customers || res?.data?.data?.customers || [];
      }
      return [];
    },
    staleTime: 30_000,
  });

  const lookupBarcode = useCallback(
    async (barcode) => {
      const normalized = normalizeBarcode(barcode);
      if (!normalized) return null;

      const cached = await getCachedProductByBarcode(STORE_ID, normalized);
      if (cached) return cached;

      const fromList = (products || []).find((p) => normalizeBarcode(p?.barcode) === normalized);
      if (fromList) return fromList;

      if (navigator.onLine) {
        try {
          const res = await invokeFunction("barcodeLookup", { store_id: STORE_ID, barcode: normalized });
          return res?.data?.product || res?.data?.data?.product || null;
        } catch {
          return null;
        }
      }
      return null;
    },
    [products, STORE_ID]
  );

  // Build Counter list:
  // - Standalone sellables: product_type='single' and parent_id is null
  // - Variants: product_type='single' and parent_id is set
  // Parent containers (product_type='parent') excluded.
  const itemsForCounter = useMemo(() => {
    const sellable = (products || []).filter((p) => p?.product_type !== "parent" && p?.is_active !== false);
    return sellable.map(toCounterItem).filter(Boolean);
  }, [products]);

  const counterItemById = useMemo(() => {
    const m = new Map();
    for (const it of itemsForCounter) m.set(it.id, it);
    return m;
  }, [itemsForCounter]);

  // Live filter grid based on new display_name rule.
  const filteredCounterItems = useMemo(() => {
    const q = String(searchValue || "").trim().toLowerCase();
    if (!q) return itemsForCounter;
    return itemsForCounter.filter((it) => {
      const hay = `${it.display_name || ""} ${it.counter_title || ""} ${it.counter_subtitle || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [itemsForCounter, searchValue]);

  const addToCart = useCallback(
    (productOrItem) => {
      if (!productOrItem) return;

      const item = productOrItem.display_name
        ? productOrItem
        : counterItemById.get(productOrItem.id) || toCounterItem(productOrItem);

      if (!item) return;
      if (item?.product_type === "parent") {
        toast.error("This is a parent container. Choose a variant or create as Single Item.", { duration: 2500 });
        return;
      }

      const productId = item.id;
      const parent_id = item.parent_id_for_sale || productId;
      const variant_id = item.variant_id_for_sale || null;
      const display_name = item.display_name || item.name || "Item";
      const unit = Number(item.selling_price_centavos || 0);
      const cost = Number(item.cost_price_centavos || 0);

      setCart((prev) => {
        const existing = prev.find((i) => i.product_id === productId);
        if (existing) {
          return prev.map((i) =>
            i.product_id === productId
              ? { ...i, qty: i.qty + 1, line_total_centavos: (i.qty + 1) * i.unit_price_centavos }
              : i
          );
        }
        return [
          ...prev,
          {
            product_id: productId,
            parent_id,
            variant_id,
            display_name,
            product_name: display_name,
            qty: 1,
            unit_price_centavos: unit,
            cost_price_centavos: cost,
            line_total_centavos: unit,
          },
        ];
      });

      toast.success(`Added: ${display_name} (+1)`, { duration: 1200 });
    },
    [counterItemById]
  );

  const decrementCart = useCallback((productId) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.product_id === productId
            ? { ...i, qty: i.qty - 1, line_total_centavos: (i.qty - 1) * i.unit_price_centavos }
            : i
        )
        .filter((i) => i.qty > 0)
    );
  }, []);

  const removeFromCart = useCallback((productId) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
  }, []);

  const handleEnterSubmit = useCallback(
    async (value) => {
      const product = await lookupBarcode(value);
      if (product && autoAddOnEnter) {
        addToCart(product);
        setSearchValue("");
        return;
      }
      if (product) {
        const it = toCounterItem(product);
        setSearchValue(it?.display_name || product.name);
        return;
      }

      const q = String(value || "").toLowerCase();
      const byName = itemsForCounter.filter((p) => String(p.display_name || "").toLowerCase().includes(q));
      if (byName.length === 1 && autoAddOnEnter) {
        addToCart(byName[0]);
        setSearchValue("");
      } else {
        toast.warning("Not found");
      }
    },
    [lookupBarcode, autoAddOnEnter, addToCart, itemsForCounter]
  );

  const subtotalCentavos = cart.reduce((sum, i) => sum + i.line_total_centavos, 0);
  const referralPct = Number(settings?.referral_discount_percent || 0);
  const referralDiscountCentavos = referralPct > 0 ? Math.floor((subtotalCentavos * referralPct) / 100) : 0;
  const totalCentavos = Math.max(0, subtotalCentavos - referralDiscountCentavos);

  const cartItemsMap = {};
  cart.forEach((i) => {
    cartItemsMap[i.product_id] = i.qty;
  });

  const handleComplete = () => {
    if (cart.length === 0) return;
    setPaymentOpen(true);
  };

  const handlePark = async () => {
    if (cart.length === 0) return;
    const client_tx_id = generateClientTxId();
    const event_id = generateEventId();
    const device_id = getDeviceId();

    const payload = {
      store_id: STORE_ID,
      client_tx_id,
      device_id,
      sale: {
        sale_type: "counter",
        status: "parked",
        items: cart.map((i) => ({
          product_id: i.product_id,
          parent_id: i.parent_id || null,
          variant_id: i.variant_id || null,
          display_name: i.display_name || i.product_name || "",
          qty: i.qty,
          unit_price_centavos: i.unit_price_centavos,
          line_discount_centavos: 0,
        })),
        discount_centavos: 0,
        payments: [],
        customer_id: null,
        notes: "",
      },
    };

    await enqueueOfflineEvent({
      store_id: STORE_ID,
      event_id,
      device_id,
      client_tx_id,
      event_type: "parkSale",
      payload,
      created_at_device: Date.now(),
    });

    toast.success("Sale parked. Di pa nabawas ang stock.");
    setCart([]);
  };

  const handlePaymentConfirm = async (payload) => {
    const client_tx_id = generateClientTxId();
    const event_id = generateEventId();
    const device_id = getDeviceId();
    const isOnline = navigator.onLine;
    const payments = Array.isArray(payload?.payments) ? payload.payments : [];

    const completeSalePayload = {
      store_id: STORE_ID,
      client_tx_id,
      device_id,
      sale: {
        sale_type: "counter",
        status: payload.status,
        items: cart.map((i) => ({
          product_id: i.product_id,
          parent_id: i.parent_id || null,
          variant_id: i.variant_id || null,
          display_name: i.display_name || i.product_name || "",
          qty: i.qty,
          unit_price_centavos: i.unit_price_centavos,
          line_discount_centavos: 0,
        })),
        discount_centavos: 0,
        payments,
        customer_id: payload.customer_id || null,
        notes: payload.notes || "",
      },
    };

    await enqueueOfflineEvent({
      store_id: STORE_ID,
      event_id,
      device_id,
      client_tx_id,
      event_type: "completeSale",
      payload: completeSalePayload,
      created_at_device: Date.now(),
    });

    await upsertLocalReceipt({
      client_tx_id,
      store_id: STORE_ID,
      local_status: "queued",
    });

    if (isOnline) {
      syncNow(STORE_ID)
        .then(() => queryClient.invalidateQueries({ queryKey: ["products", STORE_ID] }))
        .catch(() => {});
      toast.success("Sale queued & syncing…");
    } else {
      toast.info("Queued — magsi-sync pag online.", { duration: 3000 });
    }

    setCart([]);
    setPaymentOpen(false);
  };

  // Inventory health uses raw sellables
  const sellableRaw = (products || []).filter((p) => p?.product_type !== "parent" && p?.is_active !== false);
  const totalSellable = sellableRaw.length;
  const trackedCount = sellableRaw.filter((p) => !!p.track_stock).length;
  const lowDefault = Number(settings?.low_stock_threshold_default ?? 5);
  const effectiveLow = (p) => {
    const v = p?.low_stock_threshold;
    const n = Number(v);
    return Number.isFinite(n) ? n : lowDefault;
  };

  const lowStock = sellableRaw.filter((p) => {
    if (!p.track_stock) return false;
    const qty = getStockQty(p);
    return qty > 0 && qty <= effectiveLow(p);
  });
  const outOfStock = sellableRaw.filter((p) => {
    if (!p.track_stock) return false;
    const qty = getStockQty(p);
    return qty === 0;
  });
  const negativeStock = sellableRaw.filter((p) => {
    if (!p.track_stock) return false;
    const qty = getStockQty(p);
    return qty < 0;
  });

  if (!STORE_ID) return <div className="p-6 text-stone-500">Please select a store.</div>;
  if (productsErr) return <div className="p-6 text-red-600">Failed to load products.</div>;

  return (
    <div className="pb-36">
      <div className="px-4 pt-4 pb-2">
        <WedgeScannerInput
          value={searchValue}
          onChange={setSearchValue}
          onEnterSubmit={handleEnterSubmit}
          autoAddOnEnter={autoAddOnEnter}
          setAutoAddOnEnter={setAutoAddOnEnter}
          onScanIconClick={() => setScannerOpen(true)}
        />
      </div>

      <div className="px-4 pb-3">
        <button
          onClick={() => setScannerOpen(true)}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white flex flex-col items-center justify-center shadow-lg active:scale-[0.98] transition-transform"
        >
          <ScanLine className="w-7 h-7 mb-1" />
          <span className="font-bold text-base">Scan Mode</span>
          <span className="text-blue-200 text-[11px]">Continuous scan — mabilis</span>
        </button>
      </div>

      <div className="px-4 pb-4">
        <QuickProductGrid
          products={filteredCounterItems}
          cartItems={cartItemsMap}
          onTap={addToCart}
          onLongPress={decrementCart}
          loading={productsLoading}
        />
      </div>

      <div className="px-4 pb-4">
        <InventoryHealthCard
          totalSellable={totalSellable}
          trackedCount={trackedCount}
          lowStockCount={lowStock.length}
          outOfStockCount={outOfStock.length}
          negativeStockCount={negativeStock.length}
          showNegative={!!settings?.allow_negative_stock}
          onAdjustStock={() => setAdjustOpen(true)}
        />
      </div>

      <CartPanel
        items={cart}
        subtotalCentavos={subtotalCentavos}
        discountCentavos={referralDiscountCentavos}
        totalCentavos={totalCentavos}
        onInc={(pid) => {
          const item = counterItemById.get(pid);
          if (item) addToCart(item);
        }}
        onDec={decrementCart}
        onRemove={removeFromCart}
        onComplete={handleComplete}
        onPark={handlePark}
      />

      <BarcodeScannerModal
        open={scannerOpen}
        mode="continuous"
        context="counter"
        overlay={{ cartQty: cart.reduce((sum, i) => sum + (i.qty || 0), 0), totalCentavos }}
        onLookup={async (barcode) => {
          const product = await lookupBarcode(barcode);
          if (product) {
            const item = toCounterItem(product);
            addToCart(item);
            return { found: true, handled: true, label: item?.display_name || product.name };
          }
          return { found: false };
        }}
        onNotFound={() => {
          if (!navigator.onLine) {
            toast.warning("Not in offline catalog. Connect to internet to add this item.", { duration: 2500 });
          }
        }}
        onAddNew={(barcode) => {
          setScannerOpen(false);
          navigate(createPageUrl("ProductForm") + `?barcode=${barcode}`);
        }}
        onClose={() => setScannerOpen(false)}
      />

      <PaymentDrawer
        open={paymentOpen}
        storeId={STORE_ID}
        cartTotalCentavos={totalCentavos}
        customers={customers}
        onConfirm={handlePaymentConfirm}
        onClose={() => setPaymentOpen(false)}
      />

      <AdjustStockDrawer
        open={adjustOpen}
        storeId={STORE_ID}
        products={sellableRaw}
        staffMember={staffMember}
        onClose={() => setAdjustOpen(false)}
        onDone={() => {
          setAdjustOpen(false);
          queryClient.invalidateQueries({ queryKey: ["products", STORE_ID] });
        }}
      />
    </div>
  );
}
