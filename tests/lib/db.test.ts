import { describe, it, expect, vi } from "vitest";
import { withTransaction, type DbClient, type DbPool } from "@/lib/db";

function fakeClient() {
  const queries: { sql: string; values?: unknown[] }[] = [];
  const client: DbClient = {
    query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return Promise.resolve({ rows: [], rowCount: null });
    },
    release: vi.fn(),
  };
  return { client, queries };
}

function fakePool(client: DbClient): DbPool {
  return { connect: vi.fn().mockResolvedValue(client) };
}

describe("withTransaction", () => {
  it("opens a tx, sets RLS context, commits, and releases", async () => {
    const { client, queries } = fakeClient();
    const fn = vi.fn().mockResolvedValue(42);

    const result = await withTransaction(fn, { adminId: 7, pool: fakePool(client) });

    expect(result).toBe(42);
    expect(queries.map((q) => q.sql)).toEqual([
      "BEGIN",
      "SET LOCAL app.admin_id = 7",
      "COMMIT",
    ]);
    expect(queries[1].values).toBeUndefined();
    expect(fn).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalled();
  });

  it("rejects a non-integer adminId before issuing SQL", async () => {
    const { client, queries } = fakeClient();
    await expect(
      withTransaction(async () => {}, {
        adminId: "1; DROP TABLE chatbots" as unknown as number,
        pool: fakePool(client),
      }),
    ).rejects.toThrow("Invalid adminId");
    expect(queries.map((q) => q.sql)).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("does NOT set RLS context when adminId is null (public flow)", async () => {
    const { client, queries } = fakeClient();
    await withTransaction(async () => {}, { adminId: null, pool: fakePool(client) });
    expect(queries.map((q) => q.sql)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("does NOT set RLS context when adminId is omitted", async () => {
    const { client, queries } = fakeClient();
    await withTransaction(async () => {}, { pool: fakePool(client) });
    expect(queries.map((q) => q.sql)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("rolls back and rethrows on error", async () => {
    const { client, queries } = fakeClient();
    await expect(
      withTransaction(async () => {
        throw new Error("boom");
      }, { adminId: 1, pool: fakePool(client) }),
    ).rejects.toThrow("boom");
    expect(queries.map((q) => q.sql)).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });
});