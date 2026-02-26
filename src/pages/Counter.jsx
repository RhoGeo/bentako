/**
 * Counter — Primary sale screen.
 *
 * Offline contract:
 *   - All sales → enqueueOfflineEvent (Dexie offline_queue) + create local_receipt
 *   - Online: also writes directly to base44 entities (optimistic) then sync confirms
 *   - barcode lookup: Dexie cache first, then server fallback (if online)
 *   - Parked sales: NO stock deduction (enforced here + server)
 */
import React, { useState, useCallback } from "react";
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
import { generateClientTxId, generateEventId, getDeviceId, normalizeBarcode } from "@/lib/ids/deviceId";
import { syncNow } from "@/components/lib/syncManager";
import { useActiveStoreId } from "@/components/lib/activeStore";
import { useStoreSettings } from "@/components/lib/useStoreSettings";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { getStockQty } from "@/components/inventory/inventoryRules";

export default function Counter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId: STORE_ID } = useActiveStoreId();
  const { settings } = useStoreSettings(STORE_ID);
  const { staffMember, user } = useCurrentStaff(STORE_ID);
  const [searchValue, setSearchValue] = useState("");
  const [autoAddOnEnter, setAutoAddOnEnter] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [cart, setCart] = useState([]);

  // Offline-first reads: Dexie cached_* (kept fresh by SyncManager pullUpdates)
  const { data: products = [] } = useQuery({
    queryKey: ["cached-products", STORE_ID],
    queryFn: () => getAllCachedProducts(STORE_ID),
    refetchInterval: 4_000,
    initialData: [],
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["cached-customers", STORE_ID],
    queryFn: () => getAllCachedCustomers(STORE_ID),
    refetchInterval: 8_000,
    initialData: [],
  });

  // ── Barcode lookup ────────────────────────────────────────────────────────
  // Dexie first → server fallback (if online)
  const lookupBarcode = useCallback(
    async (barcode) => {
      const normalized = normalizeBarcode(barcode);
      // 1. Dexie cache (works offline)
      const cached = await getCachedProductByBarcode(STORE_ID, normalized);
      if (cached) return cached;

      // 2. In-memory products array (Dexie snapshots)
      const inMem = products.find((p) => normalizeBarcode(p.barcode) === normalized);
      if (inMem) return inMem;

      // 3. Server fallback (online only)
      if (navigator.onLine) {
        try {
          const res = await invokeFunction("barcodeLookup", { store_id: STORE_ID, barcode: normalized });
          return res?.data?.product || res?.data?.data?.product || null;
        } catch (_e) {
          return null;
        }
      }

      return null;
    },
    [products]
  );

  // ── Cart operations ───────────────────────────────────────────────────────
  const addToCart = useCallback((product) => {
  +  if (product?.product_type === "parent") {
  +    toast.error("Parent products are not sellable. Piliin ang variant/item.", { duration: 2000 });
  +    return;
  +  }

    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id
            ? { ...i, qty: i.qty + 1, line_total_centavos: (i.qty + 1) * i.unit_price_centavos }
            : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          qty: 1,
          unit_price_centavos: product.selling_price_centavos || 0,
          cost_price_centavos: product.cost_price_centavos || 0,
          line_total_centavos: product.selling_price_centavos || 0,
        },
      ];
    });
    toast.success(`Added: ${product.name} (+1)`, { duration: 1200 });
  }, []);

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

  // ── Scanner handlers ──────────────────────────────────────────────────────
  const handleScanFound = useCallback(
    async (barcode) => {
      const product = await lookupBarcode(barcode);
      if (product) {
        addToCart(product);
      } else {
        toast.warning(
          "Not in offline catalog. Connect to internet to add this item.",
          { duration: 2600 }
        );
      }
    },
    [lookupBarcode, addToCart]
  );

  const handleEnterSubmit = useCallback(
    async (value) => {
      const product = await lookupBarcode(value);
      if (product && autoAddOnEnter) {
        addToCart(product);
        setSearchValue("");
      } else if (product) {
        setSearchValue(product.name);
      } else {
        // Try name search
        const byName = products.filter((p) =>
          p.name.toLowerCase().includes(value.toLowerCase())
        );
        if (byName.length === 1 && autoAddOnEnter) {
          addToCart(byName[0]);
          setSearchValue("");
        } else {
          toast.warning("Not found");
        }
      }
    },
    [lookupBarcode, addToCart, autoAddOnEnter, products]
  );

  const subtotalCentavos = cart.reduce((sum, i) => sum + i.line_total_centavos, 0);
  const referralPct = Number(settings?.referral_discount_percent || 0);
  const referralDiscountCentavos = referralPct > 0 ? Math.floor((subtotalCentavos * referralPct) / 100) : 0;
  const totalCentavos = Math.max(0, subtotalCentavos - referralDiscountCentavos);

  const cartItemsMap = {};
  cart.forEach((i) => { cartItemsMap[i.product_id] = i.qty; });

  const handleComplete = () => {
    if (cart.length === 0) return;
    setPaymentOpen(true);
  };

  // ── Park sale — NO stock deduction ───────────────────────────────────────
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

    // Always enqueue (idempotent on server)
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

  // ── Complete sale — offline-safe ──────────────────────────────────────────
  const handlePaymentConfirm = async (payload) => {
    const client_tx_id = generateClientTxId();
    const event_id = generateEventId();
    const device_id = getDeviceId();
    const isOnline = navigator.onLine;

    // Step 10: split + partial payments.
    // PaymentDrawer returns payments[] as { method, amount_centavos } (already centavos).
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

    // 1. Always enqueue to offline_queue (Dexie) — this is the source of truth
    await enqueueOfflineEvent({
      store_id: STORE_ID,
      event_id,
      device_id,
      client_tx_id,
      event_type: "completeSale",
      payload: completeSalePayload,
      created_at_device: Date.now(),
    });

    // 2. Create local receipt stub (queued)
    await upsertLocalReceipt({
      client_tx_id,
      store_id: STORE_ID,
      local_status: "queued",
    });

    // 3. If online, attempt sync immediately (still queue-first)
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
  const addToCart = useCallback((product) => {
  +  if (product?.product_type === "parent") {
  +    toast.error("Parent products are not sellable. Piliin ang variant/item.", { duration: 2000 });
  +    return;
  +  }
    setCart((prev) => {
      ...
    });
    toast.success(`Added: ${product.name} (+1)`, { duration: 1200 });
  }, []);
  const sellable = products.filter((p) => p?.product_type !== "parent" && p?.is_active !== false);
  const totalSellable = sellable.length;
  const trackedCount = sellable.filter((p) => !!p.track_stock).length;
  const lowDefault = Number(settings?.low_stock_threshold_default ?? 5);
  const effectiveLow = (p) => {
    const v = p?.low_stock_threshold;
    const n = Number(v);
    return Number.isFinite(n) ? n : lowDefault;
  };

  const lowStock = sellable.filter((p) => {
    if (!p.track_stock) return false;
    const qty = getStockQty(p);
    return qty > 0 && qty <= effectiveLow(p);
  });
  const outOfStock = sellable.filter((p) => {
    if (!p.track_stock) return false;
    const qty = getStockQty(p);
    return qty === 0;
  });
  const negativeStock = sellable.filter((p) => {
    if (!p.track_stock) return false;
    const qty = getStockQty(p);
    return qty < 0;
  });

  return (
    <div className="pb-36">
      {/* Search + Scan (wedge scanner) */}
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

      {/* Scan Mode CTA */}
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

      {/* Quick Product Grid */}
      <div className="px-4 pb-4">
        <QuickProductGrid
          products={sellable}
          cartItems={cartItemsMap}
          onTap={addToCart}
          onLongPress={decrementCart}
        />
      </div>

      {/* Inventory Health */}
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

      {/* Cart */}
      <CartPanel
        items={cart}
        subtotalCentavos={subtotalCentavos}
        discountCentavos={referralDiscountCentavos}
        totalCentavos={totalCentavos}
        onInc={(pid) => {
          const product = products.find((p) => p.id === pid);
          if (product) addToCart(product);
        }}
        onDec={decrementCart}
        onRemove={removeFromCart}
        onComplete={handleComplete}
        onPark={handlePark}
      />

      {/* Scanner Modal — ZXing continuous */}
      <BarcodeScannerModal
        open={scannerOpen}
        mode="continuous"
        context="counter"
        overlay={{ cartQty: cart.reduce((sum, i) => sum + (i.qty || 0), 0), totalCentavos }}
        onLookup={async (barcode) => {
          const product = await lookupBarcode(barcode);
          if (product) {
            addToCart(product);
            return { found: true, handled: true, label: product.name };
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

      {/* Payment Drawer */}
      <PaymentDrawer
        open={paymentOpen}
        storeId={STORE_ID}
        cartTotalCentavos={totalCentavos}
        customers={customers}
        onConfirm={handlePaymentConfirm}
        onClose={() => setPaymentOpen(false)}
      />

      {/* Adjust Stock (Step 9) */}
      <AdjustStockDrawer
        open={adjustOpen}
        storeId={STORE_ID}
        products={sellable}
        settings={settings}
        staffMember={staffMember}
        user={user}
        onClose={() => setAdjustOpen(false)}
      />
    </div>
  );
}