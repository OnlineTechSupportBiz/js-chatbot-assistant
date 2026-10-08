import { describe, it, expect } from "vitest";
import { createMessage, getRecentByConversation, findByConversation } from "@/repository/messages";
import { fakeDb } from "../helpers";

describe("messages repository", () => {
  it("createMessage inserts and returns the id", async () => {
    const { db, calls } = fakeDb(() => [{ id: 77 }]);
    const id = await createMessage(db, {
      adminId: 1, chatbotId: 10, conversationId: 5, visitorSessionId: "sess",
      role: "user", content: "hi",
    });
    expect(id).toBe(77);
    expect(calls[0].sql).toContain("INSERT INTO messages");
    expect(calls[0].values).toHaveLength(9);
  });

  it("getRecentByConversation reverses the DESC query to chronological order", async () => {
    const { db, calls } = fakeDb((sql: string) => {
      if (/DESC LIMIT/.test(sql)) return [{ id: 3 }, { id: 2 }, { id: 1 }];
      return [];
    });
    const rows = await getRecentByConversation(db, 5, 10);
    expect(rows.map((r) => (r as { id: number }).id)).toEqual([1, 2, 3]);
    expect(calls[0].sql).toContain("ORDER BY id DESC LIMIT $2");
    expect(calls[0].values).toEqual([5, 10]);
  });

  it("findByConversation orders chronologically ascending", async () => {
    const { db, calls } = fakeDb(() => []);
    await findByConversation(db, 5);
    expect(calls[0].sql).toContain("ORDER BY id ASC");
  });
});