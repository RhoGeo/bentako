// Supabase-backed compatibility client.
//
// This repo was originally built against Base44's SDK:
//   - base44.auth.me()
//   - base44.entities.<Entity>.filter/create/update/list
//   - base44.functions.invoke(name, payload)
//
// To make migration painless, we keep the same `base44` import/export surface,
// but implement it using Supabase.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env.local and restart the dev server."
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ---- Entity/table mapping ----
// Adjust these table names to match YOUR Supabase schema.
// Default mapping is aligned with a typical POS schema.
export const ENTITY_TABLE_MAP = {
  // core
  Product: "products",
  Customer: "customers",
  Category: "categories",

  // sales
  Sale: "sales",
  SaleItem: "sale_items",
  Payment: "payments",

  // inventory
  Inventory: "inventory",
  StockLedger: "stock_ledger",

  // staff / stores
  Store: "stores",
  StoreMembership: "store_members",
  StaffMember: "staff_members",
  StoreSettings: "store_settings",
  Device: "store_devices", // change to "devices" if that's what you used

  // misc
  ActivityEvent: "activity_events",
  Payout: "payouts",
};

// Some repos use created_date, others created_at.
const COLUMN_MAP = {
  created_date: "created_at",
  createdAt: "created_at",
  updated_date: "updated_at",
  updatedAt: "updated_at",
};

function cleanWhere(where) {
  if (!where || typeof where !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function resolveTable(entityName) {
  const mapped = ENTITY_TABLE_MAP?.[entityName];
  if (mapped) return mapped;
  // fallback: Product -> products, StoreSettings -> store_settings
  const snake = String(entityName)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  // try plural-ish
  return snake.endsWith("s") ? snake : `${snake}s`;
}

function resolveColumn(col) {
  return COLUMN_MAP[col] || col;
}

async function ensureOk(res, context) {
  if (res?.error) {
    const msg = res.error.message || "Supabase error";
    const err = new Error(`${context}: ${msg}`);
    err.status = res.error.status;
    err.details = res.error;
    throw err;
  }
  return res;
}

function entityClient(entityName) {
  const table = resolveTable(entityName);

  return {
    /**
     * Base44: .filter({ field: value, ... }) -> returns array
     */
    async filter(where = {}) {
      const w = cleanWhere(where);
      let q = supabase.from(table).select("*");
      for (const [k, v] of Object.entries(w)) {
        q = q.eq(resolveColumn(k), v);
      }
      const res = await q;
      await ensureOk(res, `${entityName}.filter(${table})`);
      return res.data ?? [];
    },

    /**
     * Base44: .list("-created_date", 50)
     */
    async list(orderBy = "-created_at", limit = 50) {
      let col = String(orderBy || "");
      const desc = col.startsWith("-");
      if (desc) col = col.slice(1);
      col = resolveColumn(col || "created_at");

      const res = await supabase
        .from(table)
        .select("*")
        .order(col, { ascending: !desc })
        .limit(limit);
      await ensureOk(res, `${entityName}.list(${table})`);
      return res.data ?? [];
    },

    /**
     * Base44: .create(row) -> returns created row
     */
    async create(values) {
      const res = await supabase.from(table).insert(values).select("*").single();
      await ensureOk(res, `${entityName}.create(${table})`);
      return res.data;
    },

    /**
     * Base44: .update(id, patch) -> returns updated row
     */
    async update(id, patch) {
      // Primary attempt: conventional `id` PK
      const first = await supabase
        .from(table)
        .update(patch)
        .eq("id", id)
        .select("*")
        .maybeSingle();

      if (!first.error) return first.data;

      // Fallback for tables keyed by store_id or composite keys
      const msg = first.error?.message || "";
      if (/column\s+"id"\s+does not exist/i.test(msg) || /could not find the 'id' column/i.test(msg)) {
        // try store_id
        const second = await supabase
          .from(table)
          .update(patch)
          .eq("store_id", id)
          .select("*")
          .maybeSingle();
        await ensureOk(second, `${entityName}.update(${table})`);
        return second.data;
      }

      await ensureOk(first, `${entityName}.update(${table})`);
      return first.data;
    },
  };
}

// ---- Auth ----
async function me() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const u = data?.user;
  if (!u) throw new Error("UNAUTHORIZED");

  // Try to enrich with profile row (optional table: public.users or public.profiles)
  let full_name =
    u.user_metadata?.full_name ||
    u.user_metadata?.name ||
    u.user_metadata?.display_name ||
    "";

  try {
    const profileRes = await supabase
      .from("users")
      .select("full_name")
      .eq("id", u.id)
      .maybeSingle();
    if (!profileRes.error && profileRes.data?.full_name) {
      full_name = profileRes.data.full_name;
    }
  } catch (_e) {
    // ignore if table doesn't exist
  }

  const role =
    u.app_metadata?.role ||
    u.user_metadata?.role ||
    (u.app_metadata?.claims_admin ? "admin" : "user");

  return {
    id: u.id,
    email: u.email,
    full_name,
    role,
  };
}

async function logout(redirectTo) {
  await supabase.auth.signOut();
  if (redirectTo) {
    window.location.href = redirectTo;
  }
}

function redirectToLogin(redirectTo) {
  const next = redirectTo || window.location.href;
  const url = `/login?redirect=${encodeURIComponent(next)}`;
  window.location.href = url;
}

// ---- Edge Functions ----
async function invoke(fnName, payload) {
  const res = await supabase.functions.invoke(fnName, { body: payload });
  if (res.error) {
    const err = new Error(res.error.message || `Function ${fnName} failed`);
    err.status = res.error.status;
    throw err;
  }
  // Base44's client returns { data: ... }
  return { data: res.data };
}

export const base44 = {
  auth: {
    me,
    logout,
    redirectToLogin,
  },
  functions: {
    invoke,
  },
  // Compatibility layer for Base44-style entity calls.
  entities: new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        return entityClient(prop);
      },
    }
  ),
};
