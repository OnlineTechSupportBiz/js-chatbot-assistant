import { getPool, type DbClient, type DbPool } from "@/lib/db";

/**
 * Daily-token-budget reservations (SEC-20).
 *
 * The budget guardrail used to be read-then-spend: `SUM(tokens_used)` for the day,
 * then the model call. Concurrent requests all read the same figure, all decided
 * they were under budget and all spent — so the ceiling could be overshot by
 * roughly the in-flight count, which is exactly how a bill-shock attack is built.
 *
 * `reserveTokens` runs a SHORT transaction on its own pooled connection: it takes
 * an advisory lock for the chatbot, reads the day's spend plus the tokens already
 * reserved, and inserts a reservation only if the request fits under the budget.
 * Because the reservation is committed on its own connection it is visible to
 * other requests immediately — an uncommitted write inside the request's own
 * transaction (which stays open across the model call) would serialise nothing.
 *
 * The lock is held for this statement pair only, never across the model call, so
 * chats for one chatbot do not queue behind each other.
 *
 * Reservations expire (`RESERVATION_TTL_SECONDS`), so a request that dies
 * mid-flight — or a worker killed with SIGKILL — releases its claim on its own,
 * and `pruneExpiredReservations` keeps the table small.
 */

/** Advisory-lock namespace ("TOK"), so these locks cannot collide with other uses. */
const RESERVATION_LOCK_NS = 0x544f4b;

/** How long a reservation survives a request that never gets to settle it. */
export const RESERVATION_TTL_SECONDS = 600;

export interface Reservation {
  id: number;
}

export interface ReserveOptions {
  adminId: number;
  chatbotId: number;
  /** The chatbot's `daily_token_budget`. */
  budget: number;
  /** Worst-case completion for this request (the model's `max_tokens`). */
  estimate: number;
  ttlSeconds?: number;
}

/**
 * Claim `estimate` tokens against today's budget.
 * Returns `null` when the request does not fit — the caller answers 429 and
 * audits it, exactly as for the pre-check.
 */
export async function reserveTokens(
  opts: ReserveOptions,
  pool: DbPool = getPool(),
): Promise<Reservation | null> {
  const ttl = opts.ttlSeconds ?? RESERVATION_TTL_SECONDS;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise against other reservations for this chatbot before reading the
    // totals, so two requests cannot both observe the same "under budget" state.
    await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [
      RESERVATION_LOCK_NS,
      opts.chatbotId,
    ]);

    const spend = await client.query(
      `SELECT COALESCE(SUM(tokens_used), 0) AS used
         FROM messages
        WHERE chatbot_id = $1 AND tokens_used IS NOT NULL AND DATE(created_at) = CURRENT_DATE`,
      [opts.chatbotId],
    );
    const reserved = await client.query(
      `SELECT COALESCE(SUM(tokens), 0) AS reserved
         FROM token_reservations
        WHERE chatbot_id = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [opts.chatbotId],
    );

    const used = Number(spend.rows[0]?.used ?? 0);
    const held = Number(reserved.rows[0]?.reserved ?? 0);

    if (used + held + opts.estimate > opts.budget) {
      await client.query("ROLLBACK");
      return null;
    }

    const inserted = await client.query(
      `INSERT INTO token_reservations (admin_id, chatbot_id, tokens, expires_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP + ($4::int * INTERVAL '1 second'))
       RETURNING id`,
      [opts.adminId, opts.chatbotId, opts.estimate, ttl],
    );
    await client.query("COMMIT");
    return { id: Number(inserted.rows[0].id) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Release a reservation once the real token count has been recorded.
 *
 * The assistant message row carries the actual usage and is committed by the
 * request's own transaction moments later, so the two overlap only briefly and
 * the accounting stays conservative rather than permissive.
 */
export async function releaseReservation(id: number, pool: DbPool = getPool()): Promise<void> {
  // One autocommitted statement, but it needs a client: releasing must be visible
  // to other requests immediately, not when the caller's transaction commits.
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM token_reservations WHERE id = $1", [id]);
  } finally {
    client.release();
  }
}

/**
 * Drop expired reservations. Correctness does not depend on this — the ceiling
 * ignores expired rows — but the table would otherwise grow without bound.
 */
export async function pruneExpiredReservations(db: DbClient): Promise<number> {
  const r = await db.query("DELETE FROM token_reservations WHERE expires_at <= CURRENT_TIMESTAMP");
  return r.rowCount ?? 0;
}
