import { useAuth } from "@/lib/AuthContext";

/**
 * Multi-store helper (NO Base44 auth).
 * Data source: authMe → { memberships, stores }
 */
export function useStoresForUser() {
  const { user, memberships, stores, isLoadingAuth } = useAuth();
  return {
    user,
    memberships: memberships || [],
    stores: stores || [],
    isLoading: isLoadingAuth,
  };
}
