import { useQuery } from "@tanstack/react-query";
import { getDeviceId } from "@/lib/ids/deviceId";
import { getLocalMeta } from "@/lib/db";

export const SAFE_DEFAULTS = {
  pin_required_void_refund: true,
  // Back-compat: some deployments store combined flag
  pin_required_price_discount_override: true,
  // Preferred Step 11 flags
  pin_required_discount_override: true,
  pin_required_price_override: true,
  pin_required_stock_adjust: true,
  pin_required_export: true,
  pin_required_device_revoke: true,
  allow_negative_stock: false,
  low_stock_threshold_default: 5,
  auto_sync_on_reconnect: true,
  auto_sync_after_event: true,
};

/**
 * Store settings source of truth (offline-first):
 * - pullSyncEvents returns updates.store_settings
 * - SyncManager stores it into Dexie local_meta.store_settings_json
 */
export function useStoreSettings(storeId = "default") {
  const device_id = getDeviceId();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["store-settings", storeId, device_id],
    enabled: !!storeId && !!device_id,
    staleTime: 15_000,
    queryFn: async () => {
      const meta = await getLocalMeta(storeId, device_id);
      return meta?.store_settings_json || null;
    },
  });

  const merged = data ? { ...SAFE_DEFAULTS, ...data } : { ...SAFE_DEFAULTS };
  // If legacy combined flag exists but new ones are missing, mirror it.
  const legacy = merged.pin_required_price_discount_override;
  if (merged.pin_required_discount_override === undefined) merged.pin_required_discount_override = legacy;
  if (merged.pin_required_price_override === undefined) merged.pin_required_price_override = legacy;
  const settings = merged;
  return { settings, isLoading, isError, isUsingSafeDefaults: !data, rawSettings: data };
}
