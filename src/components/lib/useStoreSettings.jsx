import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export const SAFE_DEFAULTS = {
  pin_required_void_refund: true,
  pin_required_price_discount_override: true,
  pin_required_stock_adjust: true,
  pin_required_export: true,
  pin_required_device_revoke: true,
  allow_negative_stock: false,
  low_stock_threshold_default: 5,
  auto_sync_on_reconnect: true,
  auto_sync_after_event: true,
};

export function useStoreSettings(storeId = "default") {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["store-settings", storeId],
    queryFn: async () => {
      const results = await base44.entities.StoreSettings.filter({ store_id: storeId });
      return results[0] || null;
    },
    staleTime: 60_000,
  });

  const settings = data ? { ...SAFE_DEFAULTS, ...data } : SAFE_DEFAULTS;
  return { settings, isLoading, isError, isUsingSafeDefaults: !data, rawSettings: data };
}