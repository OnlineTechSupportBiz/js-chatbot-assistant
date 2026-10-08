import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import {
  reserveTokens,
  releaseReservation,
  RESERVATION_TTL_SECONDS,
} from "@/repository/token-reservations";

/**
 * Live proof for SEC-20: the daily token budget is claimed atomically, so a burst
 * of concurrent requests cannot collectively overshoot it.
 *
 * The whole point of this change is behaviour that only exists between concurrent
 * connections, so a fake `db` cannot demonstrate it — this test runs against the
 * real database (`RUN_DB_TESTS=1`), exactly like the RLS test.
 */
const runDbTests = process.env.RUN_DB_TESTS === "1";
const maybe = runDbTests ? describe : describe.skip;

/**
 * A chatbot id that no real chatbot has, so the reservations land on their own
 * budget rather than a seeded chatbot's.
 */
const TEST_CHATBOT_ID = 987_000_000 + Math.floor(Math.random() * 1000);

maybe("token reservations (live database)", () => {
  beforeAll(async () => {
    const pool = getPool();
    await pool.connect().then((c) => c.release());
  });

  afterAll(async () => {
    // Leave nothing behind: this budget belongs to no tenant.
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM token_reservations WHERE chatbot_id = $1", [TEST_CHATBOT_ID]);
    } finally {
      client.release();
    }
  });

  it("grants a reservation that fits and refuses one that would exceed the budget", async () => {
    const first = await reserveTokens({
      adminId: 1,
      chatbotId: TEST_CHATBOT_ID,
      budget: 100,
      estimate: 60,
    });
    expect(first).not.toBeNull();

    // 60 + 60 > 100: the second claim must be refused while the first is held.
    const second = await reserveTokens({
      adminId: 1,
      chatbotId: TEST_CHATBOT_ID,
      budget: 100,
      estimate: 60,
    });
    expect(second).toBeNull();

    await releaseReservation(first!.id);
    // With the claim released, the budget fits again.
    const third = await reserveTokens({
      adminId: 1,
      chatbotId: TEST_CHATBOT_ID,
      budget: 100,
      estimate: 60,
    });
    expect(third).not.toBeNull();
    await releaseReservation(third!.id);
  });

  it("caps a concurrent burst at the budget (the race that read-then-spend allowed)", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveTokens({ adminId: 1, chatbotId: TEST_CHATBOT_ID, budget: 100, estimate: 30 }),
      ),
    );
    const granted = attempts.filter((a) => a !== null);

    // 30 tokens each: only three fit under a 100-token budget. Before the
    // reservation existed, all eight would have read "0 used" and all eight would
    // have gone to the model.
    expect(granted).toHaveLength(3);
    expect(attempts.filter((a) => a === null)).toHaveLength(5);

    const pool = getPool();
    const client = await pool.connect();
    try {
      const held = await client.query(
        "SELECT COALESCE(SUM(tokens), 0) AS t FROM token_reservations WHERE chatbot_id = $1 AND expires_at > CURRENT_TIMESTAMP",
        [TEST_CHATBOT_ID],
      );
      expect(Number(held.rows[0].t)).toBe(90);
    } finally {
      client.release();
    }

    for (const g of granted) await releaseReservation(g!.id);
  });

  it("stops counting a reservation once it has expired", async () => {
    const expired = await reserveTokens({
      adminId: 1,
      chatbotId: TEST_CHATBOT_ID,
      budget: 100,
      estimate: 100,
      ttlSeconds: 1,
    });
    expect(expired).not.toBeNull();

    // A request that died mid-flight cannot hold the budget hostage: nothing fits
    // while the claim is live...
    expect(
      await reserveTokens({ adminId: 1, chatbotId: TEST_CHATBOT_ID, budget: 100, estimate: 10 }),
    ).toBeNull();

    await new Promise((r) => setTimeout(r, 1100));

    // ...and the budget is usable again after the TTL, with no cleanup job run.
    const after = await reserveTokens({
      adminId: 1,
      chatbotId: TEST_CHATBOT_ID,
      budget: 100,
      estimate: 10,
    });
    expect(after).not.toBeNull();
    await releaseReservation(after!.id);
    expect(RESERVATION_TTL_SECONDS).toBeGreaterThan(1);
  });
});
