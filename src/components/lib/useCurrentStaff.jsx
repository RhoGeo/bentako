import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getActiveStoreId } from "@/components/lib/activeStore";

export function useCurrentStaff(storeId = getActiveStoreId()) {
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 300_000,
  });

  const { data: staffMember, isLoading } = useQuery({
    queryKey: ["staff-member", user?.email, storeId],
    queryFn: async () => {
      if (!user?.email) return null;
      const results = await base44.entities.StaffMember.filter({
        store_id: storeId,
        user_email: user.email,
        is_active: true,
      });
      if (results.length === 0 && user.role === "admin") {
        return { role: "owner", overrides_json: {}, store_id: storeId, user_email: user.email, user_name: user.full_name };
      }
      return results[0] || null;
    },
    enabled: !!user?.email,
  });

  return { staffMember, isLoading, user };
}