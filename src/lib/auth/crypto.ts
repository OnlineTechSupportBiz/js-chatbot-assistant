import { hash, verify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

/**
 * Password hashing + token primitives, matching the PHP behavior exactly:
 * passwords use Argon2id (PASSWORD_ARGON2ID defaults: m=65536, t=4, p=1);
 * recovery codes use bcrypt (PASSWORD_BCRYPT); tokens are lowercase hex.
 */

// Argon2id is @node-rs/argon2's default algorithm; params match PHP PASSWORD_ARGON2ID.
const ARGON2ID = {
  memoryCost: 65536,
  timeCost: 4,
  parallelism: 1,
};

/** Hash a password with Argon2id (matches PHP `password_hash(..., PASSWORD_ARGON2ID)`). */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID);
}

/** Verify a password against an Argon2id hash (constant-time). */
export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return verify(hashed, password);
}

/** Random lowercase hex token (default 32 bytes = 64 hex chars, like PHP bin2hex(random_bytes(32))). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Bcrypt-hash a recovery code (matches PHP PASSWORD_BCRYPT). */
export function hashRecoveryCode(code: string): string {
  return bcrypt.hashSync(code, 10);
}

/** Verify a recovery code against a bcrypt hash. */
export function verifyRecoveryCode(code: string, hashed: string): boolean {
  return bcrypt.compareSync(code, hashed);
}