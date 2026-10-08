import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById } from "@/repository/chatbots";
import { findQuickAnswer } from "@/repository/quick-answers";
import { updateQuickAnswer, deleteQuickAnswer, ValidationError } from "@/lib/admin/quick-answers";

type RouteCtx = { params: Promise<{ chatbotId: string; id: string }> };

async function authorize(req: NextRequest, params: RouteCtx["params"]) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return { auth: null, response: auth.response, chatbotId: 0, qaId: 0 };
  const { chatbotId, id } = await params;
  return { auth, response: null as NextResponse | null, chatbotId: Number(chatbotId), qaId: Number(id) };
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const { auth, response, chatbotId, qaId } = await authorize(req, params);
  if (!auth) return response;

  try {
    const outcome = await withTransaction(async (db) => {
      const chatbot = await findChatbotById(db, chatbotId);
      if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return "missing" as const;
      const qa = await findQuickAnswer(db, qaId);
      if (!qa || qa.admin_id !== auth.user.admin_id || qa.chatbot_id !== chatbotId) return "not_found" as const;
      await updateQuickAnswer(db, auth.user, qaId, {
        trigger: auth.body.trigger ?? "",
        answer: auth.body.answer ?? "",
        is_active: auth.body.is_active ? 1 : 0,
      });
      return "ok" as const;
    }, { adminId: auth.user.admin_id });

    if (outcome === "missing") return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
    if (outcome === "not_found") return NextResponse.json({ error: "Quick answer not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const { auth, response, chatbotId, qaId } = await authorize(req, params);
  if (!auth) return response;

  const outcome = await withTransaction(async (db) => {
    const chatbot = await findChatbotById(db, chatbotId);
    if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return "missing" as const;
    const qa = await findQuickAnswer(db, qaId);
    if (!qa || qa.admin_id !== auth.user.admin_id || qa.chatbot_id !== chatbotId) return "not_found" as const;
    await deleteQuickAnswer(db, auth.user, qaId);
    return "ok" as const;
  }, { adminId: auth.user.admin_id });

  if (outcome === "missing") return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  if (outcome === "not_found") return NextResponse.json({ error: "Quick answer not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}