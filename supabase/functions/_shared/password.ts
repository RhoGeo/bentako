import { compare, hash } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

export async function hashPassword(plain: string): Promise<string> {
  // bcrypt cost is built into the library default salt generation.
  return await hash(plain);
}

export async function verifyPassword(plain: string, password_hash: string): Promise<boolean> {
  return await compare(plain, password_hash);
}
