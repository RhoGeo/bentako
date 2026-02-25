export type StaffMemberRecord = {
  id?: string;
  store_id: string;
  user_email: string;
  user_name?: string;
  role: "owner" | "manager" | "cashier";
  overrides_json?: Record<string, boolean>;
  is_active?: boolean;
};

export async function requireActiveStaff(base44: any, store_id: string, userEmail: string, userRole?: string, userName?: string): Promise<StaffMemberRecord> {
  if (!userEmail) throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
  // Prefer StoreMembership (required by POSync) when available.
  try {
    const memberships = await base44.asServiceRole.entities.StoreMembership.filter({
      store_id,
      user_email: userEmail,
      is_active: true,
    });
    const m = memberships?.[0];
    if (m) {
      const role = String(m.role || m.store_role || "cashier").toLowerCase();
      return {
        id: m.id,
        store_id,
        user_email: userEmail,
        user_name: userName || m.user_name,
        role: role === "owner" ? "owner" : role === "manager" ? "manager" : "cashier",
        overrides_json: m.overrides_json || {},
        is_active: true,
      };
    }
  } catch (_e) {
    // ignore
  }

  // NOTE: Some deployments may not have StaffMember fully seeded yet.
  // We bootstrap the first active user in a store as owner if no staff exist.
  let results: any[] = [];
  try {
    results = await base44.asServiceRole.entities.StaffMember.filter({
      store_id,
      user_email: userEmail,
      is_active: true,
    });
  } catch (_e) {
    // If the StaffMember entity is unavailable, fall back to an owner record.
    return {
      store_id,
      user_email: userEmail,
      user_name: userName,
      role: "owner",
      overrides_json: {},
      is_active: true,
    };
  }
  if (results?.length) return results[0];
  // Base44 admin fallback
  if (userRole === "admin") {
    return {
      store_id,
      user_email: userEmail,
      user_name: userName,
      role: "owner",
      overrides_json: {},
      is_active: true,
    };
  }

  // Bootstrap: if no active staff exist in this store, create owner record for this user.
  try {
    const anyStaff = await base44.asServiceRole.entities.StaffMember.filter({ store_id, is_active: true });
    if (!anyStaff || anyStaff.length === 0) {
      try {
        const created = await base44.asServiceRole.entities.StaffMember.create({
          store_id,
          user_email: userEmail,
          user_name: userName || "",
          role: "owner",
          overrides_json: {},
          is_active: true,
          created_at: new Date().toISOString(),
        });
        return created;
      } catch (_e2) {
        // If create fails, still allow as owner to avoid bricking sync.
        return {
          store_id,
          user_email: userEmail,
          user_name: userName,
          role: "owner",
          overrides_json: {},
          is_active: true,
        };
      }
    }
  } catch (_e) {
    // If we cannot check store staff list, fall back to owner to avoid sync failure.
    return {
      store_id,
      user_email: userEmail,
      user_name: userName,
      role: "owner",
      overrides_json: {},
      is_active: true,
    };
  }

  throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
}
