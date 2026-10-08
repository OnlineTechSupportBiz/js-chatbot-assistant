import { createHash } from "node:crypto";

/**
 * Every bearer token in this app is stored as a SHA-256 digest, never verbatim.
 *
 * Whoever holds a session cookie value, a password-reset link or a magic link
 * *is* the account. Reading those columns used to hand an attacker live
 * credentials for every open session and every outstanding reset link at once —
 * so a read-only database compromise (a leaked backup, an SQL injection, a
 * support export) was a full account takeover for every tenant. A digest is
 * enough to *look up* a token; it is not enough to *use* one.
 *
 * This is deliberately plain SHA-256 and not a password hash: the input is 256
 * bits of CSPRNG output, so there is nothing to brute-force or stretch, and
 * lookups must stay a single indexed comparison. Password hashing stays Argon2id.
 *
 * Callers pass the raw token; the repository layer is responsible for hashing it
 * on the way in, so a raw token never reaches the database.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
