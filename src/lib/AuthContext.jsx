import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, base44 } from "@/api/base44Client";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      setIsLoadingAuth(true);
      setAuthError(null);

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const hasSession = !!data?.session;
        if (mounted) {
          setIsAuthenticated(hasSession);
        }

        if (hasSession) {
          try {
            const me = await base44.auth.me();
            if (mounted) setUser(me);
          } catch (_e) {
            // If token exists but user fetch fails, treat as signed out.
            if (mounted) {
              setUser(null);
              setIsAuthenticated(false);
            }
          }
        } else {
          if (mounted) setUser(null);
        }
      } catch (e) {
        if (mounted) {
          setUser(null);
          setIsAuthenticated(false);
          setAuthError({ type: "auth_error", message: e?.message || "Auth error" });
        }
      } finally {
        if (mounted) setIsLoadingAuth(false);
      }
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setIsAuthenticated(!!session);
      if (!session) {
        setUser(null);
        return;
      }
      try {
        const me = await base44.auth.me();
        setUser(me);
      } catch (_e) {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const logout = async (shouldRedirect = true) => {
    await base44.auth.logout();
    if (shouldRedirect) {
      window.location.href = "/login";
    }
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoadingAuth,
      // kept for backwards compatibility with old UI
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      logout,
      navigateToLogin,
    }),
    [user, isAuthenticated, isLoadingAuth, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
