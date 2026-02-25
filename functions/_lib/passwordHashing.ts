/**
 * passwordHashing — DB-backed auth helper (NO Base44 auth).
 *
 * Uses bcrypt (bcryptjs) for hashing.
 */

import bcrypt from "npm:bcryptjs@2.4.3";

const DEFAULT_ROUNDS = 10;

export async function hashPassword(plain: string, rounds: number = DEFAULT_ROUNDS): Promise<string> {
  if (!plain || typeof plain !== "string") {
    throw Object.assign(new Error("Password required"), { code: "BAD_REQUEST" });
  }
  if (plain.length < 6) {
    throw Object.assign(new Error("Password must be at least 6 characters"), { code: "BAD_REQUEST" });
  }
  const salt = bcrypt.genSaltSync(rounds);
  return bcrypt.hashSync(plain, salt);
}

export async function verifyPassword(plain: string, password_hash: string): Promise<boolean> {
  if (!plain || !password_hash) return false;
  try {
    return bcrypt.compareSync(plain, password_hash);
  } catch (_e) {
    return false;
  }
}
