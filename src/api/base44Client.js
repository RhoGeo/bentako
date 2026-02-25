/**
 * Base44 client has been removed.
 *
 * This file remains ONLY to keep the app compiling while migrating to Supabase.
 * Any runtime use will throw with a clear message.
 */

function removed() {
  throw new Error(
    "Base44 has been removed. Migrate this screen to use Supabase (Edge Functions + Dexie caches). " +
      "Search for 'base44.entities' usage and replace it with invokeFunction(...) or Dexie reads."
  );
}

export const base44 = {
  entities: new Proxy(
    {},
    {
      get() {
        return new Proxy(
          {},
          {
            get() {
              return removed;
            },
          }
        );
      },
    }
  ),
};
