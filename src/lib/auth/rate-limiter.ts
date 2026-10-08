import type { DbClient } from "@/lib/db";

/**
 * Per-IP, database-backed rate limiter — port of the PHP `RateLimiter`.
 *
 * The `rate_limits` table (id, key, created_at) is created by the migration, so
 * no in-memory counters are used and limits work across instances. Key format is
 * `keyPrefix + ip` exactly (e.g. `login:1.2.3.4`, `rating:1.2.3.4`).
 */

/**
 * Bucket used when no trustworthy client address is available — i.e. the app is
 * exposed directly and `TRUSTED_PROXY_HOPS` is 0, so `X-Forwarded-For` is ignored
 * rather than believed.
 *
 * Limits keyed on it are deployment-wide, so callers must scale them (see the auth
 * routes) and must not treat it as an identity: a single shared bucket would let
 * one caller exhaust the allowance and lock everyone else out. Brute-force
 * controls therefore key on the account instead (see `accountRateKey`).
 */
export const UNKNOWN_IP_BUCKET = "unknown";

export async function rateLimitCheck(
  db: DbClient,
  ip: string,
  maxAttempts = 10,
  windowSec = 300,
  keyPrefix = "login:",
): Promise<boolean> {
  const key = keyPrefix + ip;
  await db.query(
    "DELETE FROM rate_limits WHERE key = $1 AND created_at < NOW() - ($2::int * INTERVAL '1 second')",
    [key, windowSec],
  );
  const r = await db.query("SELECT COUNT(*) AS cnt FROM rate_limits WHERE key = $1", [key]);
  const count = Number(r.rows[0]?.cnt ?? 0);
  return count < maxAttempts;
}

export async function rateLimitRecord(
  db: DbClient,
  ip: string,
  keyPrefix = "login:",
): Promise<void> {
  await db.query("INSERT INTO rate_limits (key, created_at) VALUES ($1, NOW())", [keyPrefix + ip]);
}

export async function rateLimitClear(
  db: DbClient,
  ip: string,
  keyPrefix = "login:",
): Promise<void> {
  await db.query("DELETE FROM rate_limits WHERE key = $1", [keyPrefix + ip]);
}