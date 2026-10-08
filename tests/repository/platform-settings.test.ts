import { describe, it, expect } from "vitest";
import { listAuditLogs } from "@/repository/audit-logs";
import { getSetting, setSetting } from "@/repository/platform-settings";
import { fakeDb } from "../helpers";

describe("listAuditLogs", () => {
  it("builds filters and pagination", async () => {
    const { db, calls } = fakeDb((sql: string) => {
      if (/SELECT COUNT/i.test(sql)) return [{ total: 12 }];
      return [{ id: 1 }];
    });
    const r = await listAuditLogs(db, { adminId: 3, action: "login", page: 2, perPage: 10 });
    expect(r.total).toBe(12);
    expect(r.rows).toHaveLength(1);

    const rowsCall = calls.find((c) => c.sql.includes("ORDER BY created_at DESC"));
    expect(rowsCall?.sql).toContain("LIMIT $3 OFFSET $4");
    expect(rowsCall?.values).toEqual([3, "login", 10, 10]);
  });

  it("uses no WHERE clause when unfiltered", async () => {
    const { db, calls } = fakeDb(() => [{ total: 0 }]);
    await listAuditLogs(db, {});
    const count = calls.find((c) => c.sql.includes("SELECT COUNT"));
    expect(count?.sql).not.toContain("WHERE");
  });
});

describe("platform settings", () => {
  it("getSetting returns the value or the default", async () => {
    const { db } = fakeDb((sql: string) => (/SELECT value/i.test(sql) ? [{ value: "0" }] : []));
    expect(await getSetting(db, "example_key", "1")).toBe("0");
    const empty = fakeDb(() => []);
    expect(await getSetting(empty.db, "example_key", "1")).toBe("1");
  });

  it("setSetting upserts on the key", async () => {
    const { db, calls } = fakeDb();
    await setSetting(db, "example_key", "1");
    expect(calls[0].sql).toContain("ON CONFLICT (key) DO UPDATE");
    expect(calls[0].values).toEqual(["example_key", "1"]);
  });
});