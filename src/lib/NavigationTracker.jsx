import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { base44 } from "@/api/base44Client";

/**
 * NavigationTracker
 * - Must render nothing.
 * - Best-effort logs page views (never blocks navigation).
 */
export default function NavigationTracker() {
  const location = useLocation();

  useEffect(() => {
    const page = location.pathname || "/";
    base44?.appLogs?.logUserInApp?.(page).catch?.(() => {});
  }, [location.pathname]);

  return null;
}
