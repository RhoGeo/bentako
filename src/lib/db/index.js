export { db, Dexie } from "./dexie";

export {
  getCachedProductByBarcode,
  upsertCachedProducts,
  upsertCachedCustomers,
  upsertCachedCategories,
  deleteCachedProductsByIds,
  deleteCachedCustomersByIds,
  deleteCachedCategoriesByIds,
  patchCachedProductSnapshot,
  patchCachedCustomerSnapshot,
  getAllCachedProducts,
  getAllCachedCustomers,
} from "./cache";

export {
  enqueueOfflineEvent,
  listOfflineQueue,
  getQueuedEvents,
  updateQueueEventStatus,
  getOfflineQueueCounts,
  listQueuedCustomerPayments,
} from "./queue";

export { upsertLocalReceipt, getLocalReceipt } from "./receipts";

export {
  getLocalMeta,
  setLocalMeta,
  setGlobalAuthSnapshot,
  getGlobalAuthSnapshot,
} from "./meta";


export {
  savePendingSale,
  listPendingSales,
  listSalesByStatus,
  getPendingSalesCounts,
  markSalesStatus,
  deletePendingSales,
  resetStaleSyncing,
} from "./pendingSales";
