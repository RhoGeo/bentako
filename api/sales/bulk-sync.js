/**
 * Vercel Serverless Function: POST /api/sales/bulk-sync
 *
 * Offline-first bulk sync endpoint.
 *
 * Auth:
 * - uses the same custom header as Supabase Edge Functions: x-posync-access-token
 * - validates it against auth_sessions (service role)
 *
 * Idempotency:
 * - sale_uuid is treated as client_tx_id (unique per store).
 * - We check public.sales(store_id, client_tx_id) before applying.
 *
 * Processing:
 * - For each sale, call public.posync_apply_sale(...) which applies the sale + inventory changes atomically.
 *
 * ENV required in Vercel:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function restHeaders() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

async function restGet(path) {
  const headers = restHeaders();
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  let jsonBody = null;
  try { jsonBody = text ? JSON.parse(text) : null; } catch { jsonBody = null; }
  if (!res.ok) {
    const msg = jsonBody?.message || jsonBody?.error || text || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    err.body = jsonBody;
    throw err;
  }
  return jsonBody;
}

async function restPost(path, body) {
  const headers = restHeaders();
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  let jsonBody = null;
  try { jsonBody = text ? JSON.parse(text) : null; } catch { jsonBody = null; }
  if (!res.ok) {
    const msg = jsonBody?.message || jsonBody?.error || text || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    err.body = jsonBody;
    throw err;
  }
  return jsonBody;
}

async function requireAuth(req) {
  const token = req.headers["x-posync-access-token"];
  if (!token) throw new Error("AUTH_REQUIRED");
  const tokenHash = sha256Hex(token);

  const sessions = await restGet(
    `/rest/v1/auth_sessions?select=session_id,user_id,device_id,access_expires_at,revoked_at&access_token_hash=eq.${tokenHash}&limit=1`
  );
  const s = sessions?.[0];
  if (!s || s.revoked_at) throw new Error("AUTH_REQUIRED");
  if (new Date(s.access_expires_at).getTime() <= Date.now()) throw new Error("AUTH_EXPIRED");

  const users = await restGet(
    `/rest/v1/user_accounts?select=user_id,full_name,email,phone_number,is_active&user_id=eq.${s.user_id}&limit=1`
  );
  const u = users?.[0];
  if (!u || u.is_active === false) throw new Error("AUTH_REQUIRED");

  return { user: u, session: s };
}

async function ensureMembership(user_id, store_id) {
  const rows = await restGet(
    `/rest/v1/store_memberships?select=store_membership_id,role,is_active&user_id=eq.${user_id}&store_id=eq.${store_id}&is_active=eq.true&limit=1`
  );
  const m = rows?.[0];
  if (!m) throw new Error("FORBIDDEN");
  return m;
}

function quoteCsv(values) {
  // PostgREST in.(...) expects quoted strings for text with hyphens
  return values.map((v) => `"${String(v).replaceAll('"', '')}"`).join(",");
}

export default async function handler(req, res) {
  // Basic CORS (optional)
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-posync-access-token");
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server env" });
    }

    const { user, session } = await requireAuth(req);
    const body = await readJson(req);

    const store_id = body?.store_id;
    const sales = Array.isArray(body?.sales) ? body.sales : [];
    if (!store_id) return json(res, 400, { error: "store_id is required" });
    if (!sales.length) return json(res, 200, { processed: [], failed: [] });

    // Membership check once per request
    await ensureMembership(user.user_id, store_id);

    // Basic validation
    for (const s of sales) {
      if (!s?.sale_uuid) return json(res, 400, { error: "sale_uuid is required for each sale" });
      if (!s?.sale || typeof s.sale !== "object" || Array.isArray(s.sale)) {
        return json(res, 400, { error: "sale must be an object for each sale" });
      }
    }

    const uuids = sales.map((s) => String(s.sale_uuid));
    const existingRows = await restGet(
      `/rest/v1/sales?select=client_tx_id&store_id=eq.${store_id}&client_tx_id=in.(${quoteCsv(uuids)})`
    );
    const existing = new Set((existingRows || []).map((r) => String(r.client_tx_id)));

    const processed = [];
    const failed = [];

    for (const s of sales) {
      const sale_uuid = String(s.sale_uuid);
      if (existing.has(sale_uuid)) {
        processed.push(sale_uuid);
        continue;
      }

      try {
        await restPost(`/rest/v1/rpc/posync_apply_sale`, {
          p_store_id: store_id,
          p_user_id: user.user_id,
          p_device_id: s.device_id || session.device_id,
          p_client_tx_id: sale_uuid,
          p_sale: s.sale,
        });
        processed.push(sale_uuid);
      } catch (e) {
        const msg = e?.message || String(e);
        const code = e?.body?.code || e?.body?.hint || null;

        // classify a few known permanent validation errors
        const permanent =
          /Parent products are not sellable/i.test(msg) ||
          /invalid input syntax for type json/i.test(msg) ||
          /required/i.test(msg) ||
          /must be/i.test(msg);

        failed.push({ sale_uuid, message: msg, code, permanent });
      }
    }

    return json(res, 200, { processed, failed });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = msg === "AUTH_REQUIRED" || msg === "AUTH_EXPIRED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return json(res, status, { error: msg });
  }
}
