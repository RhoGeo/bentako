import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

// Base44 SDK client (frontend)
// IMPORTANT: Do not override serverUrl with an empty string.
// Only pass functionsVersion when it's a non-empty string.
const config = {
  appId,
  token,
  requiresAuth: false,
  appBaseUrl,
  ...(typeof functionsVersion === "string" && functionsVersion.trim()
    ? { functionsVersion: functionsVersion.trim() }
    : {}),
};

export const base44 = createClient(config);
