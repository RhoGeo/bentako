export async function getStoreSettings(base44: any, store_id: string) {
  try {
    const results = await base44.asServiceRole.entities.StoreSettings.filter({ store_id });
    if (results?.[0]) return results[0];
    // Best-effort create default settings so permission gates have something to read.
    try {
      return await base44.asServiceRole.entities.StoreSettings.create({
        store_id,
        created_at: new Date().toISOString(),
      });
    } catch (_e2) {
      return null;
    }
  } catch (_e) {
    return null;
  }
}
