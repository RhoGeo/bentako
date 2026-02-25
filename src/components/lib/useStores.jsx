import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Multi-store helper.
 *
 * In this repo, authoritative membership rows are StaffMember records:
 *   StaffMember(store_id + user_email + role + is_active)
 *
 * Store display names come from StoreSettings.store_name.
 */
export function useStoresForUser({ includeArchived = false } = {}) {
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 300_000,
  });

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ["user-stores", user?.email, includeArchived ? "all" : "active"],
    enabled: !!user?.email,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.email) return [];

      const memberships = await base44.entities.StaffMember.filter({
        user_email: user.email,
        is_active: true,
      });

      const storeIds = Array.from(new Set((memberships || []).map((m) => m.store_id).filter(Boolean)));
      if (storeIds.length === 0) return [];

      // Resolve display names from StoreSettings (has store_name in this repo).
      const resolved = await Promise.all(
        storeIds.map(async (sid) => {
          try {
            const settings = await base44.entities.StoreSettings.filter({ store_id: sid });
            return {
              store_id: sid,
              store_name: settings?.[0]?.store_name || sid,
              // Optional schema field (if present)
              is_archived: !!settings?.[0]?.is_archived,
            };
          } catch (_e) {
            return { store_id: sid, store_name: sid, is_archived: false };
          }
        })
      );

      const filtered = includeArchived ? resolved : resolved.filter((s) => !s.is_archived);
      return filtered.sort((a, b) => (a.store_name || a.store_id).localeCompare(b.store_name || b.store_id));
    },
  });

  return { stores, isLoading, user };
}

/** Convenience hook to include archived stores (for owner/admin tooling). */
export function useAllStoresForUser() {
  return useStoresForUser({ includeArchived: true });
}
