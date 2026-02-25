import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { revokeSessionByAccessToken } from "./_lib/auth.ts";

function getBearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export async function authSignOut(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    const token = getBearer(req);
    if (!token) return jsonFail(401, "UNAUTHORIZED", "Unauthorized");
    await revokeSessionByAccessToken(base44, token);
    return jsonOk({ signed_out: true });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(authSignOut);
