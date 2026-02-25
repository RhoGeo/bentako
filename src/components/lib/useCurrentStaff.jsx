import { getActiveStoreId } from "@/components/lib/activeStore";
import { useAuth } from "@/lib/AuthContext";

export function useCurrentStaff(storeId = getActiveStoreId()) {
  const { user, memberships, isLoadingAuth } = useAuth();
  const staffMember = (memberships || []).find((m) => m.store_id === storeId) || null;
  return { staffMember, isLoading: isLoadingAuth, user };
}