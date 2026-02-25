import { db } from "./dexie";

export async function getLocalMeta(store_id, device_id) {
  if (!store_id || !device_id) return null;
  return (await db.local_meta.get([store_id, device_id])) || null;
}

export async function setLocalMeta(store_id, device_id, patch) {
  if (!store_id || !device_id) return;
  const existing = (await getLocalMeta(store_id, device_id)) || { store_id, device_id };
  await db.local_meta.put({ ...existing, ...patch, store_id, device_id });
}

/**
 * Step 4.3 requirement:
 * Persist minimal auth snapshot into Dexie local_meta using store_id="__global__".
 */
export async function setGlobalAuthSnapshot(device_id, { auth_json, user_json } = {}) {
  if (!device_id) return;
  await setLocalMeta("__global__", device_id, {
    auth_json: auth_json ?? null,
    user_json: user_json ?? null,
    last_sync_time: Date.now(),
  });
}

export async function getGlobalAuthSnapshot(device_id) {
  if (!device_id) return null;
  return getLocalMeta("__global__", device_id);
}
