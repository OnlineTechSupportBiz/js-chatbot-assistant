import type { DbClient } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

/**
 * Session store on the `sessions` table (id, user_id, admin_id, ip_address,
 * user_agent, payload, last_activity). The payload is JSON text holding the
 * session user + CSRF token + remember flag. Mirrors what PHP stored server-side
 * (the PHP code left this table vestigial and used file sessions; the port uses
 * it, which is strictly better for multi-instance deployments).
 *
 * The `id` column holds a SHA-256 digest of the cookie value, never the cookie
 * value itself (SEC-17): the session id is a bearer credential, so a database read
 * must not yield working sessions. Every function here takes the RAW id from the
 * request and hashes it — callers never hash, and the digest never leaves this
 * module.
 *
 * Expiry: PHP's file sessions were garbage-collected by `session.gc_maxlifetime`,
 * so sessions expired even when the browser kept the cookie. The Postgres store
 * has no equivalent, so the port enforces it explicitly: `findSessionById`
 * returns the row's age and idle age computed **in SQL** (both sides of the
 * subtraction are database clocks, so a `timestamp without time zone` column
 * cannot be misread in the app's local zone), and `SessionManager.start` rejects
 * anything past its TTL.
 */

export interface SessionRow {
  id: string;
  user_id: number | null;
  admin_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: string;
  last_activity: number;
  created_at: string;
  /** Seconds since the session row was created (absolute lifetime). */
  age_seconds: number;
  /** Seconds since the last request touched the session (idle timeout). */
  idle_seconds: number;
}

/** Longest lifetime any session may reach, remember-me included (30 days). */
export const MAX_SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function createSession(
  db: DbClient,
  data: {
    id: string;
    userId: number | null;
    adminId: number | null;
    ipAddress: string | null;
    userAgent: string | null;
    payload: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (id, user_id, admin_id, ip_address, user_agent, payload, last_activity)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      hashToken(data.id),
      data.userId,
      data.adminId,
      data.ipAddress,
      data.userAgent,
      data.payload,
      Math.floor(Date.now() / 1000),
    ],
  );
}

/** Load a session with its age/idle age computed by the database (see above). */
export async function findSessionById(db: DbClient, id: string): Promise<SessionRow | null> {
  const r = await db.query(
    `SELECT *,
            EXTRACT(EPOCH FROM (NOW() - created_at))::bigint AS age_seconds,
            GREATEST(0, EXTRACT(EPOCH FROM NOW())::bigint - last_activity) AS idle_seconds
       FROM sessions
      WHERE id = $1`,
    [hashToken(id)],
  );
  const row = r.rows[0] as SessionRow | undefined;
  if (!row) return null;
  return { ...row, age_seconds: Number(row.age_seconds), idle_seconds: Number(row.idle_seconds) };
}

export async function updateSessionPayload(db: DbClient, id: string, payload: string): Promise<void> {
  await db.query("UPDATE sessions SET payload = $2, last_activity = $3 WHERE id = $1", [
    hashToken(id),
    payload,
    Math.floor(Date.now() / 1000),
  ]);
}

export async function deleteSession(db: DbClient, id: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE id = $1", [hashToken(id)]);
}

/**
 * Revoke every session for a user. Called when credentials change (password
 * reset), so a session captured before the change cannot outlive it — the exact
 * reason users are told to reset a password.
 */
export async function deleteSessionsByUserId(db: DbClient, userId: number): Promise<void> {
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

/**
 * Revoke every session for a user **except** the caller's own. Used when the
 * account's security posture changes (MFA enabled/disabled): other devices are
 * signed out, the current one is not.
 */
export async function deleteSessionsByUserIdExcept(
  db: DbClient,
  userId: number,
  keepSessionId: string,
): Promise<void> {
  await db.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [
    userId,
    hashToken(keepSessionId),
  ]);
}

/**
 * Garbage-collect sessions that cannot be valid any more, whatever their payload
 * says: nothing outlives the 30-day ceiling, and the idle clock is authoritative.
 * Expired rows are already refused at load, so this only bounds table growth —
 * the equivalent of PHP's probabilistic session GC.
 */
export async function deleteExpiredSessions(db: DbClient): Promise<number> {
  const r = await db.query(
    `DELETE FROM sessions
      WHERE created_at < NOW() - ($1::int * INTERVAL '1 second')
         OR last_activity < EXTRACT(EPOCH FROM NOW())::bigint - $1::bigint`,
    [MAX_SESSION_AGE_SECONDS],
  );
  return r.rowCount ?? 0;
}
