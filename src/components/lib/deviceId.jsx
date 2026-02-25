/**
 * Device identity + client transaction/event ID generators.
 * device_id: generated once via uuid.v4(), persisted in localStorage.
 */
import { v4 as uuidv4 } from "uuid";

const DEVICE_KEY = "posync_device_id";

/** Returns (or generates + persists) the stable device UUID for this browser. */
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/**
 * Generates a stable, unique client transaction ID for a sale.
 * Format: tx-<devicePrefix>-<timestamp>-<random>
 */
export function generateClientTxId() {
  const devicePrefix = getDeviceId().slice(0, 8);
  return `tx-${devicePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generates a stable, unique event ID for an offline queue entry.
 * Format: ev-<devicePrefix>-<timestamp>-<random>
 */
/**
 * Spec: event_id MUST be uuid.v4()
 */
export function generateEventId() {
  return uuidv4();
}

/**
 * Backwards-compatible alias used by older parts of the UI.
 * (Now also uuid.v4 so it remains stable + spec-compliant.)
 */
export function generateClientEventId() {
  return generateEventId();
}

/** Normalizes a barcode string: trim whitespace, collapse internal spaces. */
export function normalizeBarcode(input) {
  return (input || "").trim().replace(/\s+/g, "");
}