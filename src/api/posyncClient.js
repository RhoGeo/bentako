import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";
import { getAccessToken } from "@/lib/auth/session";

function trimSlash(s) {
  return typeof s === "string" ? s.replace(/\/+$/, "") : s;
}

function isProbablyCapacitor() {
  if (typeof window === "undefined") return false;
  // Capacitor injects window.Capacitor in native builds.
  // Some builds don't expose isNativePlatform, so treat presence as likely-native.
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === "function") return !!cap.isNativePlatform();
  if (cap) return true;
  // Heuristic: native webview origin is typically https://localhost
  return window.location?.hostname === "localhost" && window.location?.protocol === "https:";
}

/**
 * In Capacitor (Android/iOS), the app origin is https://localhost.
 * Base44 API calls MUST go to the Base44 app domain (appBaseUrl), otherwise
 * requests will be treated as local-file requests and return 404/500.
 */
function resolveServerUrl() {
  const base = trimSlash(appParams?.appBaseUrl);

  // Native build: never fall back to localhost.
  if (isProbablyCapacitor()) {
    if (!base) {
      throw new Error(
        "Missing Base44 server URL for native build. Set VITE_BASE44_APP_BASE_URL (e.g. https://bentako.base44.app) before building the app, or provide app_base_url as a runtime param."
      );
    }
    if (base.includes("localhost")) {
      throw new Error(
        `Invalid Base44 server URL (points to localhost): ${base}. Set VITE_BASE44_APP_BASE_URL to your Base44 app domain.`
      );
    }
    return base;
  }

  // Web build: allow origin during local dev, but prefer configured base.
  if (base) return base;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/**
 * POSync function invoker.
 *
 * IMPORTANT:
 * - We DO NOT call base44.auth.* (forbidden).
 * - We use functions.invoke and attach POSync custom access_token as Authorization.
 */
export function getPosyncClient() {
  const { appId, functionsVersion, appBaseUrl } = appParams;
  const token = getAccessToken();
  const serverUrl = resolveServerUrl();

  if (!serverUrl) {
    throw new Error(
      "Missing Base44 server URL. Set VITE_BASE44_APP_BASE_URL (e.g. https://bentako.base44.app) before building the app."
    );
  }

  return createClient({
    appId,
    token: token || undefined,
    functionsVersion,
    // IMPORTANT: must be absolute for Capacitor builds.
    serverUrl,
    requiresAuth: false,
    appBaseUrl: trimSlash(appBaseUrl)
  });
}

export async function invokeFunction(functionName, payload) {
  const client = getPosyncClient();
  return client.functions.invoke(functionName, payload);
}
