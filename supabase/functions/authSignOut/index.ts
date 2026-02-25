import { corsHeaders } from "../_shared/cors.ts";
import { jsonFailFromError, jsonOk } from "../_shared/response.ts";
import { revokeSessionByToken } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await revokeSessionByToken(req);
    return jsonOk({});
  } catch (err) {
    return jsonFailFromError(err);
  }
});
