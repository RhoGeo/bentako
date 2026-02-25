import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { invokeFunction } from "@/api/posyncClient";
import {
  clearSession,
  getSession,
  isSessionExpired,
  setSession,
} from "@/lib/auth/session";
import { getDeviceId } from "@/lib/ids/deviceId";
import { setGlobalAuthSnapshot } from "@/lib/db";

const AuthContext = createContext(null);

function unwrap(res) {
  // base44 SDK: { data: { ok, data } }
  return res?.data?.data || res?.data || res;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [stores, setStores] = useState([]);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  const isAuthenticated = !!user;

  const persistGlobal = async (nextUser, nextSession) => {
    try {
      await setGlobalAuthSnapshot(getDeviceId(), {
        auth_json: nextSession ?? null,
        user_json: nextUser ?? null,
      });
    } catch (_e) {}
  };

  const bootstrap = async () => {
    setIsLoadingAuth(true);
    setAuthError(null);

    const session = getSession();
    if (!session || isSessionExpired(session)) {
      clearSession();
      setUser(null);
      setMemberships([]);
      setStores([]);
      await persistGlobal(null, null);
      setIsLoadingAuth(false);
      return;
    }

    try {
      const res = await invokeFunction("authMe", {});
      const payload = unwrap(res);
      if (payload?.ok === false) {
        throw new Error(payload?.error?.message || "authMe failed");
      }
      const data = payload?.data || payload;
      setUser(data?.user || null);
      setMemberships(data?.memberships || []);
      setStores(data?.stores || []);
      await persistGlobal(data?.user || null, session);
    } catch (err) {
      clearSession();
      setUser(null);
      setMemberships([]);
      setStores([]);
      await persistGlobal(null, null);
      setAuthError({ type: "auth_required", message: err?.message || "Authentication required" });
    } finally {
      setIsLoadingAuth(false);
    }
  };

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Call after authSignUp/authSignIn (Step 7) */
  const commitSession = async (session, nextUser) => {
    setSession(session);
    setUser(nextUser || null);
    await persistGlobal(nextUser || null, session);
  };

  const signOut = async () => {
    try {
      await invokeFunction("authSignOut", {});
    } catch (_e) {}
    clearSession();
    setUser(null);
    setMemberships([]);
    setStores([]);
    await persistGlobal(null, null);
  };

  const value = useMemo(
    () => ({
      user,
      memberships,
      stores,
      isAuthenticated,
      isLoadingAuth,
      authError,
      refreshAuth: bootstrap,
      commitSession,
      signOut,
      // legacy fields used by the existing app shell
      isLoadingPublicSettings: false,
      navigateToLogin: () => {},
      logout: () => signOut(),
    }),
    [user, memberships, stores, isAuthenticated, isLoadingAuth, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
