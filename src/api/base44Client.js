import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { getAccessToken } from '@/lib/auth/session';

const trimSlash = (s) => (typeof s === 'string' ? s.replace(/\/+$/, '') : s);

function isProbablyCapacitor() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
  if (cap) return true;
  return window.location?.hostname === 'localhost' && window.location?.protocol === 'https:';
}

function resolveServerUrl() {
  const base = trimSlash(appParams?.appBaseUrl);
  if (isProbablyCapacitor()) {
    if (!base || base.includes('localhost')) {
      throw new Error(
        'Base44 serverUrl is not configured for native build. Set VITE_BASE44_APP_BASE_URL to your Base44 app domain (e.g. https://bentako.base44.app).'
      );
    }
    return base;
  }
  return base || (typeof window !== 'undefined' ? window.location.origin : '');
}

const { appId, functionsVersion, appBaseUrl } = appParams;

// Create a client with POSync custom auth token (NO Base44 built-in auth)
export const base44 = createClient({
  appId,
  token: getAccessToken() || undefined,
  functionsVersion,
  // IMPORTANT: must be absolute for Capacitor builds.
  serverUrl: resolveServerUrl(),
  requiresAuth: false,
  appBaseUrl: trimSlash(appBaseUrl)
});
