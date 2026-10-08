import type { DbClient } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

/**
 * Password-reset repository — port of the PHP `password_resets` table usage.
 * Tokens are 64-hex, expire after `ttlSeconds`, single-use (`used` flag), and
 * one active token per email (upserted on `email` primary key).
 *
 * The `token` column holds a SHA-256 digest of the emailed token (SEC-17): a reset
 * link is account takeover for whoever holds it, so it must not be readable from
 * the database. Callers pass the raw token from the URL; hashing happens here.
 */

export interface PasswordResetRow {
  email: string;
  token: string;
  expires_at: string;
  used: number;
  created_at: string;
}

export async function upsertPasswordReset(
  db: DbClient,
  email: string,
  token: string,
  ttlSeconds: number,
): Promise<void> {
  await db.query(
    `INSERT INTO password_resets (email, token, expires_at, used)
     VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 second'), 0)
     ON CONFLICT (email) DO UPDATE
       SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, used = 0`,
    [email, hashToken(token), ttlSeconds],
  );
}

export async function findValidPasswordReset(
  db: DbClient,
  email: string,
  token: string,
): Promise<PasswordResetRow | null> {
  const r = await db.query(
    "SELECT * FROM password_resets WHERE email = $1 AND token = $2 AND used = 0 AND expires_at > NOW()",
    [email, hashToken(token)],
  );
  return (r.rows[0] as PasswordResetRow) ?? null;
}

export async function markPasswordResetUsed(db: DbClient, email: string): Promise<void> {
  await db.query("UPDATE password_resets SET used = 1 WHERE email = $1", [email]);
}

/** True if an unused, unexpired reset token already exists (no re-issue). */
export async function hasActivePasswordReset(db: DbClient, email: string): Promise<boolean> {
  const r = await db.query(
    "SELECT EXISTS(SELECT 1 FROM password_resets WHERE email = $1 AND used = 0 AND expires_at > NOW()) AS exists",
    [email],
  );
  return Boolean(r.rows[0]?.exists);
}