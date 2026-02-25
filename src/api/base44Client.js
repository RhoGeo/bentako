import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { getAccessToken } from '@/lib/auth/session';

const { appId, functionsVersion, appBaseUrl } = appParams;

const trimSlash = (s) => (typeof s === 'string' ? s.replace(/\/+$/, '') : s);
const serverUrl = trimSlash(appBaseUrl) || (typeof window !== 'undefined' ? window.location.origin : '');

//Create a client with authentication required
export const base44 = createClient({
  appId,
  // POSync custom auth token (NO Base44 built-in auth)
  token: getAccessToken() || undefined,
  functionsVersion,
  // IMPORTANT: must be absolute for Capacitor builds.
  serverUrl,
  requiresAuth: false,
  appBaseUrl: trimSlash(appBaseUrl)
});
