import { describe, it, expect } from "vitest";
import { matchMessage, findActiveByChatbot, reorder } from "@/repository/quick-answers";
import { fakeDb } from "../helpers";

describe("quick-answers repository", () => {
  it("matchMessage lowercases/trims the message and matches on LOWER(TRIM(trigger))", async () => {
    const { db, calls } = fakeDb(() => [{ id: 1, answer: "canned" }]);
    const r = await matchMessage(db, 7, 3, "  Hours  ");
    expect(r?.answer).toBe("canned");
    expect(calls[0].sql).toContain("LOWER(TRIM(trigger)) = $3");
    expect(calls[0].values).toEqual([7, 3, "hours"]);
  });

  it("findActiveByChatbot filters is_active = 1", async () => {
    const { db, calls } = fakeDb(() => []);
    await findActiveByChatbot(db, 7, 3);
    expect(calls[0].sql).toContain("is_active = 1");
    expect(calls[0].sql).toContain("ORDER BY priority DESC");
  });

  it("reorder assigns priority = count - index (0 = highest)", async () => {
    const { db, calls } = fakeDb();
    await reorder(db, 7, 3, [10, 20, 30]);
    expect(calls.map((c) => c.values?.[0])).toEqual([3, 2, 1]);
    expect(calls.map((c) => c.values?.[1])).toEqual([10, 20, 30]);
  });
});