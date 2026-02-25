import React, { useEffect, useMemo } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { pagesConfig } from "@/pages.config";
import { useAuth } from "@/lib/AuthContext";
import { StoreScopeProvider } from "@/components/lib/storeScope";
import {
  getActiveStoreId,
  hasActiveStoreSelection,
  setActiveStoreId,
} from "@/components/lib/activeStore";
import { createPageUrl } from "@/utils";

import SignIn from "@/screens/auth/SignIn";
import SignUp from "@/screens/auth/SignUp";
import Welcome from "@/screens/auth/Welcome";
import FirstStoreSetup from "@/screens/onboarding/FirstStoreSetup";
import NoStoreHome from "@/screens/NoStoreHome";
import PageNotFound from "@/lib/PageNotFound";

const { Pages, Layout, mainPage } = pagesConfig;

const LayoutWrapper = ({ children, currentPageName }) =>
  Layout ? <Layout currentPageName={currentPageName}>{children}</Layout> : <>{children}</>;

function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
    </div>
  );
}

function RequireAuth({ children }) {
  const location = useLocation();
  const { isLoadingAuth, isAuthenticated, stores } = useAuth();

  const storesList = stores || [];
  const storeIdOf = (s) => s?.id || s?.store_id;
  const allowedStoreIds = useMemo(
    () => new Set(storesList.map(storeIdOf).filter(Boolean)),
    [storesList]
  );

  // Auto-select valid store when only one exists.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!storesList?.length) return;
    if (storesList.length === 1 && !hasActiveStoreSelection()) {
      setActiveStoreId(storeIdOf(storesList[0]));
    }
  }, [isAuthenticated, storesList]);

  // Auto-correct invalid selection.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!storesList?.length) return;
    const active = getActiveStoreId();
    if (active && allowedStoreIds.size > 0 && !allowedStoreIds.has(active)) {
      setActiveStoreId(storeIdOf(storesList[0]));
    }
  }, [isAuthenticated, storesList, allowedStoreIds]);

  if (isLoadingAuth) return <LoadingScreen />;
  if (!isAuthenticated) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  // If user has no store membership, allow affiliate-only mode.
  // - After Signup flow, Welcome routes explicitly to /first-store (Step 7).
  // - On normal boot/sign-in with 0 stores, route to /no-store.
  const noStoreAllowed = new Set(["/first-store", "/no-store", createPageUrl("Affiliate")]);
  if (storesList.length === 0 && !noStoreAllowed.has(location.pathname)) {
    return <Navigate to="/no-store" replace />;
  }

  // If multiple stores, force explicit StoreSwitcher before entering main tabs.
  if (
    storesList.length > 1 &&
    !hasActiveStoreSelection() &&
    location.pathname !== createPageUrl("StoreSwitcher")
  ) {
    return <Navigate to={createPageUrl("StoreSwitcher")} replace />;
  }

  return children;
}

export default function AppRouter() {
  const mainPageKey = mainPage ?? "Counter";

  return (
    <StoreScopeProvider>
      <Routes>
        {/* Auth stack */}
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/welcome" element={<Welcome />} />

        {/* Onboarding (authed) */}
        <Route
          path="/first-store"
          element={
            <RequireAuth>
              <FirstStoreSetup />
            </RequireAuth>
          }
        />

        {/* No-store home (affiliate-only allowed) */}
        <Route
          path="/no-store"
          element={
            <RequireAuth>
              <NoStoreHome />
            </RequireAuth>
          }
        />

        {/* App stack (authed) */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <Navigate to={createPageUrl(mainPageKey)} replace />
            </RequireAuth>
          }
        />

        {Object.entries(Pages).map(([key, Page]) => (
          <Route
            key={key}
            path={createPageUrl(key)}
            element={
              <RequireAuth>
                <LayoutWrapper currentPageName={key}>
                  <Page />
                </LayoutWrapper>
              </RequireAuth>
            }
          />
        ))}

        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </StoreScopeProvider>
  );
}
