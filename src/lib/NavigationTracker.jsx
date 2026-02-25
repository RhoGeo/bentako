import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Lightweight navigation side-effects.
 * - Scroll to top on route change
 * - No Base44 auth calls (forbidden)
 */
export default function NavigationTracker() {
  const location = useLocation();

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } catch (_e) {
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);

  return null;
}
