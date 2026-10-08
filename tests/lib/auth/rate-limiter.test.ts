import { describe, it, expect, vi } from "vitest";
import { rateLimitCheck, rateLimitRecord, rateLimitClear } from "@/lib/auth/rate-limiter";
import type { DbClient } from "@/lib/db";

function fakeDb(counts: Record<string, number>) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const db: DbClient = {
    query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (/SELECT COUNT/i.test(sql)) {
        const key = String(values?.[0]);
        const cnt = counts[key] ?? 0;
        return Promise.resolve({ rows: [{ cnt }], rowCount: null });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    },
    release: vi.fn(),
  };
  return { db, calls };
}

describe("rateLimitCheck", () => {
  it("allows when under the limit", async () => {
    const { db } = fakeDb({ "login:1.1.1.1": 3 });
    expect(await rateLimitCheck(db, "1.1.1.1", 10, 300)).toBe(true);
  });

  it("denies when at/over the limit", async () => {
    const { db } = fakeDb({ "login:1.1.1.1": 10 });
    expect(await rateLimitCheck(db, "1.1.1.1", 10, 300)).toBe(false);
  });

  it("prunes stale rows for the exact key with the window", async () => {
    const { db, calls } = fakeDb({});
    await rateLimitCheck(db, "9.9.9.9", 5, 60, "rating:");
    const del = calls.find((c) => /^DELETE/.test(c.sql));
    expect(del?.sql).toContain("DELETE FROM rate_limits WHERE key = $1");
    expect(del?.values).toEqual(["rating:9.9.9.9", 60]);
  });

  it("uses prefix + ip as the key", async () => {
    const { db, calls } = fakeDb({});
    await rateLimitCheck(db, "2.2.2.2", 10, 300, "login:");
    const count = calls.find((c) => /SELECT COUNT/.test(c.sql));
    expect(count?.values).toEqual(["login:2.2.2.2"]);
  });
});

describe("rateLimitRecord / rateLimitClear", () => {
  it("records an attempt with the prefixed key", async () => {
    const { db, calls } = fakeDb({});
    await rateLimitRecord(db, "3.3.3.3", "login:");
    expect(calls[0].sql).toContain("INSERT INTO rate_limits (key, created_at)");
    expect(calls[0].values).toEqual(["login:3.3.3.3"]);
  });

  it("clears all entries for the key", async () => {
    const { db, calls } = fakeDb({});
    await rateLimitClear(db, "3.3.3.3", "login:");
    expect(calls[0].sql).toContain("DELETE FROM rate_limits WHERE key = $1");
    expect(calls[0].values).toEqual(["login:3.3.3.3"]);
  });
});