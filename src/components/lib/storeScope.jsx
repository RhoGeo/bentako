/**
 * Store scope helpers.
 *
 * Spec: every query must be store-scoped by store_id.
 * Multi-store UI is implemented later, but all reads/writes should call getActiveStoreId().
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const STORE_KEY = "posync_active_store_id";

export function getActiveStoreId() {
  return localStorage.getItem(STORE_KEY) || "default";
}

export function setActiveStoreId(storeId) {
  if (!storeId) return;
  localStorage.setItem(STORE_KEY, storeId);
}

/**
 * Best-effort store list fetch.
 * - If StoreMembership exists, prefer it.
 * - Fallback to a single default store.
 */
export function useMyStores() {
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 300_000,
  });

  return useQuery({
    queryKey: ["my-stores", user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      try {
        // 1) Memberships → Stores
        // Preferred: user_id (Supabase Auth)
        let memberships = [];
        if (user?.id) {
          try {
            memberships = await base44.entities.StoreMembership.filter({
              user_id: user.id,
            });
          } catch (_e) {
            memberships = [];
          }
        }

        // Fallback: user_email (older/Base44-style)
        if ((!memberships || memberships.length === 0) && user?.email) {
          memberships = await base44.entities.StoreMembership.filter({
            user_email: user.email,
            is_active: true,
          });
        }

        if (memberships?.length) {
          // Avoid relying on complex query operators; fetch store records one-by-one.
          const stores = [];
          for (const m of memberships) {
            if (!m.store_id) continue;
            try {
              const found = await base44.entities.Store.filter({ id: m.store_id });
              if (found?.[0]) stores.push({ ...found[0], store_name: found[0].name || found[0].store_name, membership: m });
              else stores.push({ id: m.store_id, store_name: m.store_name || "Store", membership: m });
            } catch (_e) {
              stores.push({ id: m.store_id, store_name: m.store_name || "Store", membership: m });
            }
          }
          return stores.length ? stores : [{ id: "default", store_name: "My Sari-Sari" }];
        }
      } catch (_e) {
        // ignore — entity may not exist in some deployments
      }
      return [{ id: "default", store_name: "My Sari-Sari" }];
    },
    staleTime: 60_000,
    initialData: [{ id: "default", store_name: "My Sari-Sari" }],
  });
}

export const StoreScopeContext = React.createContext({
  storeId: "default",
  setStoreId: () => {},
});

export function StoreScopeProvider({ children }) {
  const [storeId, _setStoreId] = React.useState(getActiveStoreId());

  const setStoreId = React.useCallback((next) => {
    setActiveStoreId(next);
    _setStoreId(next);
  }, []);

  return (
    <StoreScopeContext.Provider value={{ storeId, setStoreId }}>
      {children}
    </StoreScopeContext.Provider>
  );
}

export function useStoreScope() {
  return React.useContext(StoreScopeContext);
}
