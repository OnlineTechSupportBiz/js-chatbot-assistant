import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById } from "@/repository/chatbots";
import { findConversationById } from "@/repository/conversations";
import { findByConversation } from "@/repository/messages";
import { findByConversation as findLeadByConversation } from "@/repository/leads";

type RouteCtx = { params: Promise<{ chatbotId: string; cid: string }> };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const { chatbotId, cid } = await params;

  const detail = await withTransaction(async (db) => {
    const chatbot = await findChatbotById(db, Number(chatbotId));
    if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return null;

    const conversation = await findConversationById(db, Number(cid));
    if (!conversation || conversation.chatbot_id !== Number(chatbotId)) return { __missing: true as const, result: null };

    const messages = await findByConversation(db, Number(cid));
    const lead = await findLeadByConversation(db, Number(cid));
    return { __missing: false as const, result: { conversation, messages, lead } };
  }, { adminId: auth.user.admin_id });

  if (detail === null) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  if (detail.__missing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  return NextResponse.json(detail.result);
}