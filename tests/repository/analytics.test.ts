import { describe, it, expect } from "vitest";
import { countByAdmin, countByUser, uniqueVisitorsByAdmin, perChatbotByAdmin, getRecentWithMessages } from "@/repository/conversations";
import { chartByAdmin, last7DaysByAdmin, sourceBreakdownByAdmin, avgResponseTimeByAdmin, totalTokensByAdmin, countByChatbot } from "@/repository/messages";
import { fakeDb } from "../helpers";

describe("analytics counts", () => {
  it("conversation counts scope by admin vs user chatbots", async () => {
    const a = fakeDb(() => [{ c: 4 }]);
    expect(await countByAdmin(a.db, 1)).toBe(4);
    expect(a.calls[0].values).toEqual([1]);

    const u = fakeDb(() => [{ c: 2 }]);
    expect(await countByUser(u.db, 7)).toBe(2);
    expect(u.calls[0].sql).toContain("INNER JOIN chatbots");
  });

  it("uniqueVisitorsByAdmin counts distinct session ids", async () => {
    const { db, calls } = fakeDb(() => [{ c: 9 }]);
    expect(await uniqueVisitorsByAdmin(db, 1)).toBe(9);
    expect(calls[0].sql).toContain("COUNT(DISTINCT visitor_session_id)");
  });

  it("perChatbotByAdmin returns per-chatbot stats", async () => {
    const { db, calls } = fakeDb(() => [{ chatbot_id: 3, chatbot_name: "Bot", count: 5, daily_token_budget: 1000, tokens_today: 120 }]);
    const rows = await perChatbotByAdmin(db, 1);
    expect(rows[0].chatbot_name).toBe("Bot");
    expect(calls[0].sql).toContain("LEFT JOIN messages");
    expect(calls[0].sql).toContain("GROUP BY cb.id, cb.name, cb.daily_token_budget");
  });

  it("getRecentWithMessages left-joins the latest message", async () => {
    const { db, calls } = fakeDb(() => []);
    await getRecentWithMessages(db, 3, 10);
    expect(calls[0].sql).toContain("LEFT JOIN messages m ON m.id = (");
    expect(calls[0].values).toEqual([3, 10]);
  });
});

describe("message analytics", () => {
  it("chartByAdmin groups by date", async () => {
    const { db, calls } = fakeDb(() => [{ date: "2026-09-29", count: 3 }]);
    const rows = await chartByAdmin(db, 1, "2026-09-22", "2026-09-29");
    expect(rows[0].count).toBe(3);
    expect(calls[0].sql).toContain("GROUP BY DATE(created_at)");
    expect(calls[0].values).toEqual([1, "2026-09-22", "2026-09-29"]);
  });

  it("last7DaysByAdmin computes a 7-day window", async () => {
    const { db, calls } = fakeDb(() => []);
    const now = new Date("2026-09-29T12:00:00");
    await last7DaysByAdmin(db, 1, now);
    expect(calls[0].values?.[1]).toBe("2026-09-22");
    expect(calls[0].values?.[2]).toBe("2026-09-29");
  });

  it("sourceBreakdownByAdmin filters assistant rows", async () => {
    const { db, calls } = fakeDb(() => [{ source: "rag", count: 7 }]);
    const rows = await sourceBreakdownByAdmin(db, 1);
    expect(rows[0]).toEqual({ source: "rag", count: 7 });
    expect(calls[0].sql).toContain("role = 'assistant'");
  });

  it("avgResponseTimeByAdmin returns null when no rows", async () => {
    const { db } = fakeDb(() => []);
    expect(await avgResponseTimeByAdmin(db, 1)).toBeNull();
    const { db: db2 } = fakeDb(() => [{ avg: "123.5" }]);
    expect(await avgResponseTimeByAdmin(db2, 1)).toBe(123.5);
  });

  it("totalTokensByAdmin sums tokens_used", async () => {
    const { db } = fakeDb(() => [{ t: 512 }]);
    expect(await totalTokensByAdmin(db, 1)).toBe(512);
  });

  it("countByChatbot counts messages for a chatbot", async () => {
    const { db } = fakeDb(() => [{ c: 11 }]);
    expect(await countByChatbot(db, 3)).toBe(11);
  });
});