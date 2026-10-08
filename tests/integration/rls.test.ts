import { describe, it, expect, beforeAll } from "vitest";
import { createPool, withTransaction, type DbPool, type DbClient } from "@/lib/db";

/**
 * Live RLS isolation test — proving one tenant cannot read another's data.
 *
 * Preconditions (two-role mode):
 *   - migrations already run by the `migrator` role (npm run migrate with DB_MIGRATOR_USER set)
 *   - app role (DB_USER) granted DML privileges but does NOT own the tables
 *   - a disposable test database
 *
 * Run only when explicitly requested:
 *   RUN_DB_TESTS=1 DB_HOST=... DB_USER=... DB_PASS=... npx vitest run
 *
 * Uses the real `withTransaction` helper, so this also verifies that the
 * `SET LOCAL app.admin_id` code path correctly scopes queries for the pooled
 * non-owner app role. (The PHP suite had NO equivalent RLS test — only an
 * app-layer WHERE-clause test.)
 */
const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("RLS tenant isolation (live Postgres, two-role mode)", () => {
  let pool: DbPool;

  beforeAll(() => {
    pool = createPool({
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? "5432"),
      database: process.env.DB_NAME ?? "chatbot_assistant",
      user: process.env.DB_USER ?? "chatbot_user",
      password: process.env.DB_PASS ?? "",
      schema: process.env.DB_SCHEMA ?? "chatbot_schema",
    });
  });

  async function allocId(client: DbClient): Promise<number> {
    const r = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS v FROM users");
    return Number(r.rows[0].v);
  }

  it("one tenant cannot read another tenant's chatbots", async () => {
    const tag = Date.now();
    let idA = 0;
    let idB = 0;

    // Create two admin users via the RLS null-bypass path (unauthenticated insert).
    await withTransaction(
      async (c) => {
        idA = await allocId(c);
        idB = idA + 1;
        await c.query(
          `INSERT INTO users (id, admin_id, name, email, password_hash, role)
           VALUES ($1, $1, 'Admin A', 'a' || $2 || '@x.com', 'x', 'admin'),
                  ($3, $3, 'Admin B', 'b' || $2 || '@x.com', 'x', 'admin')`,
          [idA, tag, idB],
        );
      },
      { pool },
    );

    try {
      // Insert one chatbot per tenant, each with RLS context set.
      await withTransaction(
        async (c) => {
          await c.query(
            `INSERT INTO chatbots (admin_id, created_by, name, widget_token)
             VALUES ($1, $1, 'Bot A', 'tokA' || $2)`,
            [idA, tag],
          );
        },
        { pool, adminId: idA },
      );
      await withTransaction(
        async (c) => {
          await c.query(
            `INSERT INTO chatbots (admin_id, created_by, name, widget_token)
             VALUES ($1, $1, 'Bot B', 'tokB' || $2)`,
            [idB, tag],
          );
        },
        { pool, adminId: idB },
      );

      // Each tenant sees only its own chatbot.
      const seenByA = await withTransaction(
        async (c) => {
          const r = await c.query("SELECT name FROM chatbots ORDER BY name");
          return r.rows.map((x) => x.name);
        },
        { pool, adminId: idA },
      );
      const seenByB = await withTransaction(
        async (c) => {
          const r = await c.query("SELECT name FROM chatbots ORDER BY name");
          return r.rows.map((x) => x.name);
        },
        { pool, adminId: idB },
      );

      expect(seenByA).toEqual(["Bot A"]);
      expect(seenByB).toEqual(["Bot B"]);
    } finally {
      // Leave the database as it was found: the fixtures this test creates are not
      // part of the corpus, and a leaked row shows up in the admin UI afterwards.
      await withTransaction(
        async (c) => {
          await c.query("DELETE FROM chatbots WHERE admin_id IN ($1, $2)", [idA, idB]);
          await c.query("DELETE FROM users WHERE id IN ($1, $2)", [idA, idB]);
        },
        { pool },
      );
    }
  });

  /**
   * Regression guard for the configuration that made every policy inert: RLS was
   * enabled but never FORCEd, and in single-role mode the app role owns the tables
   * — and PostgreSQL exempts a table's owner from its own policies. Without FORCE,
   * "isolation" is just whatever the WHERE clauses happen to filter.
   */
  it("has RLS enabled AND forced on every tenant table", async () => {
    // The tables documented as internal/non-tenant (see docs/data-model.md):
    // the work queue, the rate-limit ledger, the platform singleton, the
    // pre-session reset table, and the migration runner's own bookkeeping.
    const nonTenant = [
      "document_jobs",
      "rate_limits",
      "platform_settings",
      "password_resets",
      "schema_migrations",
    ];

    const tables = await withTransaction(
      async (c) => {
        const r = await c.query(
          `SELECT c.relname AS name,
                  c.relrowsecurity AS enabled,
                  c.relforcerowsecurity AS forced
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relkind = 'r'
              AND NOT (c.relname = ANY($2::text[]))
            ORDER BY c.relname`,
          [process.env.DB_SCHEMA ?? "chatbot_schema", nonTenant],
        );
        return r.rows as Array<{ name: string; enabled: boolean; forced: boolean }>;
      },
      { pool },
    );

    expect(tables.length).toBeGreaterThan(10);
    const offenders = tables.filter((t) => !t.enabled || !t.forced).map((t) => t.name);
    expect(offenders).toEqual([]);
  });
});