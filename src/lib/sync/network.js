/**
 * Network utilities (Step 5)
 *
 * Offline-first rule:
 * - We treat navigator.onLine as a hint.
 * - Sync triggers on browser online/offline events.
 */

export function isOnline() {
  if (typeof navigator === "undefined") return true;
  return !!navigator.onLine;
}

/**
 * Subscribe to online/offline changes.
 * @param {(state:{online:boolean})=>void} cb
 * @returns {() => void}
 */
export function subscribeNetwork(cb) {
  if (typeof window === "undefined") return () => {};

  const emit = () => {
    try {
      cb({ online: isOnline() });
    } catch (_e) {}
  };

  const onOnline = () => emit();
  const onOffline = () => emit();

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  emit();

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
