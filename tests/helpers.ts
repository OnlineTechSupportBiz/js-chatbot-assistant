import type { DbClient } from "@/lib/db";

/**
 * Shared fake DbClient for repository/service unit tests. Records every query
 * (SQL + params) and returns rows via an optional responder.
 */
export function fakeDb(responder?: (sql: string, values?: unknown[]) => unknown[]) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const db: DbClient = {
    query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      let rows = responder ? responder(sql, values) : [];
      // Convenience for inserts whose id is not interesting to the test. Narrow on
      // `RETURNING id` only: `RETURNING *` must not be faked, or a caller that
      // reads a real column (e.g. a consumed magic link's email) gets a phantom row.
      if (rows.length === 0 && /RETURNING\s+id/i.test(sql)) {
        rows = [{ id: 1 }];
      }
      return Promise.resolve({ rows, rowCount: rows.length });
    },
    release() {},
  };
  return { db, calls };
}