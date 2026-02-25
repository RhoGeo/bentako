/**
 * Backwards-compatible re-exports.
 * Canonical implementation: src/lib/ids/deviceId.js
 */

export {
  getDeviceId,
  generateClientTxId,
  generateEventId,
  generateClientEventId,
  normalizeBarcode,
  normalizeBarcodeOrEmpty,
} from "@/lib/ids/deviceId";