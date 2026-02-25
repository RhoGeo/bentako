/**
 * Device identity + client transaction/event IDs + barcode normalization.
 *
 * - device_id generated once via uuid.v4() and persisted.
 * - event_id MUST be uuid.v4() for offline events.
 */

import { v4 as uuidv4 } from "uuid";

const DEVICE_KEY = "posync_device_id";

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function generateClientTxId() {
  const devicePrefix = getDeviceId().slice(0, 8);
  return `tx-${devicePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateEventId() {
  return uuidv4();
}

export function generateClientEventId() {
  return generateEventId();
}

function isPrintableAscii(str) {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 32 || c === 127) return false;
  }
  return true;
}

/**
 * Barcode normalization:
 * - trim
 * - remove all whitespace
 * - reject non-printables/control chars
 */
export function normalizeBarcode(input) {
  const raw = (input ?? "").toString();
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!isPrintableAscii(trimmed)) return "";
  return trimmed.replace(/\s+/g, "");
}

export function normalizeBarcodeOrEmpty(input) {
  return normalizeBarcode(input) || "";
}
