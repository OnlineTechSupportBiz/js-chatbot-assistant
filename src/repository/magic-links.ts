import type { DbClient } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

/**
 * Magic-link repository — port of the PHP `MagicLink` model.
 * Tokens are 64-hex, expire after `ttlSeconds`, and are single-use.
 *
 * The `token` column holds a SHA-256 digest of the emailed link (SEC-17): the link
 * is a bearer credential, so it is not readable from the database. Callers pass
 * the raw token from the URL; hashing happens here.
 */

export interface MagicLinkRow {
  id: number;
  email: string;
  admin_id: number;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export async function createMagicLink(
  db: DbClient,
  email: string,
  adminId: number,
  token: string,
  ttlSeconds: number,
): Promise<void> {
  await db.query(
    `INSERT INTO magic_links (email, admin_id, token, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 second'))`,
    [email, adminId, hashToken(token), ttlSeconds],
  );
}

export async function findValidMagicLink(db: DbClient, token: string): Promise<MagicLinkRow | null> {
  const r = await db.query(
    "SELECT * FROM magic_links WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL LIMIT 1",
    [hashToken(token)],
  );
  return (r.rows[0] as MagicLinkRow) ?? null;
}

/**
 * Consume a magic link atomically: one UPDATE both validates (unused, unexpired)
 * and marks it used, so two concurrent requests holding the same token cannot
 * both pass a check-then-mark pair.
 */
export async function consumeMagicLink(db: DbClient, token: string): Promise<MagicLinkRow | null> {
  const r = await db.query(
    `UPDATE magic_links
        SET used_at = NOW()
      WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING *`,
    [hashToken(token)],
  );
  return (r.rows[0] as MagicLinkRow) ?? null;
}

/** Single-use consumption guarded by `used_at IS NULL`. */
export async function markMagicLinkUsed(db: DbClient, token: string): Promise<void> {
  await db.query("UPDATE magic_links SET used_at = NOW() WHERE token = $1 AND used_at IS NULL", [
    hashToken(token),
  ]);
}

/** True if an unexpired, unused link for the email exists within the last 60s. */
export async function hasRecentMagicLink(db: DbClient, email: string): Promise<boolean> {
  const r = await db.query(
    `SELECT EXISTS(
       SELECT 1 FROM magic_links
       WHERE email = $1 AND used_at IS NULL AND expires_at > NOW()
         AND created_at > NOW() - INTERVAL '60 seconds'
     ) AS exists`,
    [email],
  );
  return Boolean(r.rows[0]?.exists);
}

export async function pruneExpiredMagicLinks(db: DbClient): Promise<void> {
  await db.query("DELETE FROM magic_links WHERE expires_at <= NOW()");
}