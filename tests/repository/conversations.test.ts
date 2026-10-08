import { describe, it, expect } from "vitest";
import { findOrCreate, rate, countRecentBySession, sumTokensUsedToday } from "@/repository/conversations";
import { fakeDb } from "../helpers";

describe("conversations repository", () => {
  it("findOrCreate returns existing when findBySession matches", async () => {
    const existing = [{ id: 9 }];
    const { db, calls } = fakeDb(() => existing);
    const r = await findOrCreate(db, 1, 10, "sess");
    expect((r as { id: number }).id).toBe(9);
    expect(calls).toHaveLength(1); // no INSERT
  });

  it("findOrCreate inserts then re-fetches by id", async () => {
    const { db } = fakeDb((sql: string) => {
      if (sql.includes("visitor_session_id = $2")) return [];
      if (sql.includes("INSERT INTO conversations")) return [{ id: 42 }];
      if (sql.includes("WHERE id = $1")) return [{ id: 42 }];
      return [];
    });
    const r = await findOrCreate(db, 1, 10, "sess", "1.2.3.4");
    expect((r as { id: number }).id).toBe(42);
  });

  it("rate strips non-digits and rejects out-of-range/blanks", async () => {
    const { db, calls } = fakeDb();
    expect(await rate(db, 1, "5")).toBe(true);
    expect(calls[0].values).toEqual([5, 1]);

    expect(await rate(db, 1, "abc")).toBe(false);
    expect(await rate(db, 1, "0")).toBe(false);
    expect(await rate(db, 1, "9")).toBe(false);
    expect(await rate(db, 1, "3.7")).toBe(false); // "37" → out of range
  });

  it("countRecentBySession / sumTokensUsedToday return numbers", async () => {
    const a = fakeDb(() => [{ c: 4 }]);
    expect(await countRecentBySession(a.db, 10, "sess", 1)).toBe(4);
    const b = fakeDb(() => [{ t: 123 }]);
    expect(await sumTokensUsedToday(b.db, 10)).toBe(123);
  });
});