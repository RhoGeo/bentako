import { ok, fail, json } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { sha256Hex } from "../_shared/crypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, { status: 200 });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use POST", undefined, 405);

  try {
    const token = req.headers.get("x-posync-access-token") || "";
    if (!token) return ok({});

    const supabase = getServiceClient();
    const tokenHash = await sha256Hex(token);

    await supabase
      .from("auth_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("access_token_hash", tokenHash);

    return ok({});
  } catch (e) {
    return fail("SERVER_ERROR", e?.message || String(e), e, 500);
  }
});
