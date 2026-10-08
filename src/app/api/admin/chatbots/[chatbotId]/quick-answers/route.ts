import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser, requireAdminSession } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById } from "@/repository/chatbots";
import { findByChatbot } from "@/repository/quick-answers";
import { storeQuickAnswer, ValidationError } from "@/lib/admin/quick-answers";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminSession(_req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;
  const id = Number(chatbotId);

  const result = await withTransaction(async (db) => {
    const chatbot = await findChatbotById(db, id);
    if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return null;
    return findByChatbot(db, auth.user.admin_id, id);
  }, { adminId: auth.user.admin_id });

  if (result === null) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;
  const id = Number(chatbotId);

  try {
    const created = await withTransaction(async (db) => {
      const chatbot = await findChatbotById(db, id);
      if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return "missing" as const;
      return storeQuickAnswer(db, auth.user, id, { trigger: auth.body.trigger ?? "", answer: auth.body.answer ?? "" });
    }, { adminId: auth.user.admin_id });

    if (created === "missing") return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id: created });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}