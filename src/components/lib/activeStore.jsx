import { useEffect, useState } from "react";

const KEY = "posync_active_store_id";

export function getRawActiveStoreId() {
  return localStorage.getItem(KEY);
}

export function hasActiveStoreSelection() {
  return !!localStorage.getItem(KEY);
}

export function getActiveStoreId() {
  // Backwards-compatible fallback for single-store setups.
  return localStorage.getItem(KEY) || "default";
}

export function setActiveStoreId(storeId) {
  if (!storeId) return;
  localStorage.setItem(KEY, storeId);
  try {
    window.dispatchEvent(new CustomEvent("posync:active_store_changed", { detail: { storeId } }));
  } catch (_e) {}
}

export function useActiveStoreId() {
  const [storeId, setStoreIdState] = useState(getActiveStoreId());

  useEffect(() => {
    const handler = (e) => {
      const next = e?.detail?.storeId || getActiveStoreId();
      setStoreIdState(next);
    };
    window.addEventListener("posync:active_store_changed", handler);
    return () => window.removeEventListener("posync:active_store_changed", handler);
  }, []);

  const setStoreId = (id) => {
    setActiveStoreId(id);
    setStoreIdState(id);
  };

  return { storeId, setStoreId };
}
