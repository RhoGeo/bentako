import { getStoreSettings } from "./storeSettings.ts";

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Proof is expected to be the SHA-256 hash of the PIN.
 * Server compares to StoreSettings.owner_pin_hash.
 */
export async function verifyOwnerPinProof(base44: any, store_id: string, owner_pin_proof?: string | null): Promise<boolean> {
  const settings = await getStoreSettings(base44, store_id);
  const stored = settings?.owner_pin_hash;
  if (!stored) return true; // no PIN set
  if (!owner_pin_proof) return false;
  return owner_pin_proof === stored;
}
