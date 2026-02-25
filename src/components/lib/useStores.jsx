import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Multi-store helper.
 *
 * Base44 access patterns vary by project; in this repo the authoritative membership
 * rows are StaffMember records with store_id + user_email.
 */
export function useStoresForUser() {
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 300_000,
  });

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ["user-stores", user?.email],
    enabled: !!user?.email,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.email) return [];

      const memberships = await base44.entities.StaffMember.filter({
        user_email: user.email,
        is_active: true,
      });

      const storeIds = Array.from(
        new Set((memberships || []).map((m) => m.store_id).filter(Boolean))
      );

      if (storeIds.length === 0) return [];

      // Resolve display names from StoreSettings (has store_name in this repo).
      const resolved = await Promise.all(
        storeIds.map(async (sid) => {
          try {
            const settings = await base44.entities.StoreSettings.filter({ store_id: sid });
            return { store_id: sid, store_name: settings?.[0]?.store_name || sid };
          } catch (_e) {
            return { store_id: sid, store_name: sid };
          }
        })
      );

      return resolved.sort((a, b) => a.store_name.localeCompare(b.store_name));
    },
  });

  return { stores, isLoading, user };
}