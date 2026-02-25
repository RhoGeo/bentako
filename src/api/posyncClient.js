import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";
import { getAccessToken } from "@/lib/auth/session";

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
  return createClient({
    appId,
    token: token || undefined,
    functionsVersion,
    serverUrl: "",
    requiresAuth: false,
    appBaseUrl,
  });
}

export async function invokeFunction(functionName, payload) {
  const client = getPosyncClient();
  return client.functions.invoke(functionName, payload);
}
