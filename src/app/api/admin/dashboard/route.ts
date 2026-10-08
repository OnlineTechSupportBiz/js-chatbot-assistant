import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth/require";
import { countByAdmin as countChatbots } from "@/repository/chatbots";
import { countByAdmin as countConversations, uniqueVisitorsByAdmin } from "@/repository/conversations";
import { countByAdmin as countMessages, chartByAdmin, totalTokensByAdmin, sourceBreakdownByAdmin } from "@/repository/messages";
import { perChatbotByAdmin } from "@/repository/conversations";

// Message chart range: 7 / 30 / 90 days, default 30 (PHP parity).
const RANGES = [7, 30, 90] as const;

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;

  const requested = Number(req.nextUrl.searchParams.get("range") ?? 30);
  const range = (RANGES as readonly number[]).includes(requested) ? requested : 30;

  const stats = await withTransaction(async (db) => {
    // Run sequentially: withTransaction hands us a single pooled client, and
    // node-postgres forbids concurrent query() calls on one client.
    const chatbots = await countChatbots(db, auth.user.admin_id);
    const conversations = await countConversations(db, auth.user.admin_id);
    const messages = await countMessages(db, auth.user.admin_id);
    const visitors = await uniqueVisitorsByAdmin(db, auth.user.admin_id);
    const tokens = await totalTokensByAdmin(db, auth.user.admin_id);

    // Chart over the requested range with zero-count days filled in, so the
    // timeline is continuous (PHP fills these too).
    const now = new Date();
    const from = new Date(now.getTime() - (range - 1) * 86400000);
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const rows = await chartByAdmin(db, auth.user.admin_id, ymd(from), ymd(now));
    const byDate = new Map(rows.map((r) => [r.date, Number(r.count)]));
    const chart = Array.from({ length: range }, (_, i) => {
      const d = new Date(from.getTime() + i * 86400000);
      const date = ymd(d);
      return { date, count: byDate.get(date) ?? 0 };
    });

    const sources = await sourceBreakdownByAdmin(db, auth.user.admin_id);
    const chatbotStats = await perChatbotByAdmin(db, auth.user.admin_id);
    return { chatbots, conversations, messages, unique_visitors: visitors, total_tokens: tokens, chart_range: range, chart, source_breakdown: sources, chatbot_stats: chatbotStats };
  }, { adminId: auth.user.admin_id });

  return NextResponse.json(stats);
}