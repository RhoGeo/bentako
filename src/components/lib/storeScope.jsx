/**
 * Store scope helpers.
 *
 * Spec: every query must be store-scoped by store_id.
 * Multi-store UI is implemented later, but all reads/writes should call getActiveStoreId().
 */
import React from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  getActiveStoreId as getActiveStoreIdRaw,
  setActiveStoreId as setActiveStoreIdRaw,
} from "@/components/lib/activeStore";

export function getActiveStoreId() {
  return getActiveStoreIdRaw();
}

export function setActiveStoreId(storeId) {
  setActiveStoreIdRaw(storeId);
}

/**
 * Best-effort store list fetch.
 * - If StoreMembership exists, prefer it.
 * - Fallback to a single default store.
 */
export function useMyStores() {
  const { stores, memberships, isLoadingAuth } = useAuth();
  const data = (stores || []).map((s) => ({
    id: s.id || s.store_id,
    store_name: s.store_name || s.name,
    membership: (memberships || []).find((m) => m.store_id === (s.id || s.store_id)) || null,
  }));

  return {
    data,
    isLoading: isLoadingAuth,
    error: null,
  };
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
