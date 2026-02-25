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
      if (!user?.email && !user?.id) return [];

      // 1) Preferred (Supabase): store_members table keyed by user_id
      let storeIds = [];
      if (user?.id) {
        try {
          const memberships = await base44.entities.StoreMembership.filter({ user_id: user.id });
          storeIds = Array.from(new Set((memberships || []).map((m) => m.store_id).filter(Boolean)));
        } catch (_e) {
          storeIds = [];
        }
      }

      // 2) Fallback (older/Base44): StaffMember rows keyed by user_email
      if (storeIds.length === 0 && user?.email) {
        const staff = await base44.entities.StaffMember.filter({
          user_email: user.email,
          is_active: true,
        });
        storeIds = Array.from(new Set((staff || []).map((m) => m.store_id).filter(Boolean)));
      }

      // Admin fallback: keep the single-store UX if nothing is configured yet.
      if (storeIds.length === 0 && user?.role === "admin") {
        return [{ store_id: "default", store_name: "Default Store" }];
      }

      // Resolve store display name from stores table first, then store_settings.
      const resolved = await Promise.all(
        storeIds.map(async (sid) => {
          // Try stores table (recommended)
          try {
            const storeRows = await base44.entities.Store.filter({ id: sid });
            if (storeRows?.[0]) {
              return { store_id: sid, store_name: storeRows[0].name || storeRows[0].store_name || sid };
            }
          } catch (_e) {}

          // Fallback: store_settings has store_name in some schemas
          try {
            const settings = await base44.entities.StoreSettings.filter({ store_id: sid });
            return { store_id: sid, store_name: settings?.[0]?.store_name || sid };
          } catch (_e) {
            return { store_id: sid, store_name: sid };
          }
        })
      );

      return resolved.sort((a, b) => String(a.store_name).localeCompare(String(b.store_name)));
    },
  });

  return { stores, isLoading, user };
}
