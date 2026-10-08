import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById } from "@/repository/chatbots";
import { cloneChatbot } from "@/lib/chatbot/chatbot";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;

  const newName = (auth.body.new_name ?? "").trim();
  if (newName === "") {
    return NextResponse.json({ error: "A name for the cloned chatbot is required." }, { status: 400 });
  }

  const newId = await withTransaction(async (db) => {
    const chatbot = await findChatbotById(db, Number(chatbotId));
    if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return null;
    return cloneChatbot(db, auth.user, Number(chatbotId), newName);
  }, { adminId: auth.user.admin_id });

  if (newId === null) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  return NextResponse.json({ ok: true, id: newId });
}