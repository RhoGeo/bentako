import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { getAccessToken } from '@/lib/auth/session';

const { appId, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  // POSync custom auth token (NO Base44 built-in auth)
  token: getAccessToken() || undefined,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});
