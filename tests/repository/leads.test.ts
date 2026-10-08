import { describe, it, expect } from "vitest";
import { createLead, findByConversation, updateLead } from "@/repository/leads";
import { fakeDb } from "../helpers";

describe("leads repository", () => {
  it("createLead inserts with captured_at=NOW() and returns id", async () => {
    const { db, calls } = fakeDb(() => [{ id: 6 }]);
    const id = await createLead(db, {
      adminId: 1, chatbotId: 10, conversationId: 5, visitorSessionId: "sess",
      name: "John", email: "j@x.com", phone: null, summary: "s",
    });
    expect(id).toBe(6);
    expect(calls[0].sql).toContain("INSERT INTO leads");
    expect(calls[0].values).toHaveLength(8); // captured_at uses NOW() in SQL
  });

  it("findByConversation limits to one lead per conversation", async () => {
    const { db, calls } = fakeDb(() => [{ id: 1 }]);
    const lead = await findByConversation(db, 5);
    expect(lead?.id).toBe(1);
    expect(calls[0].sql).toContain("WHERE conversation_id = $1 LIMIT 1");
  });

  it("updateLead builds a dynamic SET clause", async () => {
    const { db, calls } = fakeDb();
    await updateLead(db, 6, { name: "Jane", email: "j2@x.com" });
    expect(calls[0].sql).toContain("name = $1, email = $2");
    expect(calls[0].values).toEqual(["Jane", "j2@x.com", 6]);
  });
});