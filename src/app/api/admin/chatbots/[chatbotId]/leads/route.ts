import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById } from "@/repository/chatbots";
import { findByChatbot } from "@/repository/leads";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;

  const leads = await withTransaction(async (db) => {
    const chatbot = await findChatbotById(db, Number(chatbotId));
    if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return null;
    return findByChatbot(db, auth.user.admin_id, Number(chatbotId));
  }, { adminId: auth.user.admin_id });

  if (leads === null) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  return NextResponse.json(leads);
}