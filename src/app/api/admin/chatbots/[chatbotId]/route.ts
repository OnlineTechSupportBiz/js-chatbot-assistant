import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser, requireAdminSession } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById, deleteChatbot } from "@/repository/chatbots";
import { updateChatbotFromInput, type ChatbotFormInput } from "@/lib/chatbot/chatbot";
import { getConfig } from "@/lib/config";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;
  const chatbot = await withTransaction(async (db) => {
    const c = await findChatbotById(db, Number(chatbotId));
    if (!c || !canAccessChatbot(c, auth.user)) return null;
    return c;
  }, { adminId: auth.user.admin_id });
  if (!chatbot) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  // The form shows the server-wide abuse ceilings next to the tenant's own limits,
  // so it can explain why a value is capped. These are not secrets.
  return NextResponse.json({ ...chatbot, rateCeilings: getConfig().publicChatRate });
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;

  const input: ChatbotFormInput = { name: auth.body.name ?? "", ...auth.body };
  const outcome = await withTransaction(async (db) => {
    const c = await findChatbotById(db, Number(chatbotId));
    if (!c || !canAccessChatbot(c, auth.user)) return "missing" as const;
    await updateChatbotFromInput(db, auth.user, Number(chatbotId), input);
    return "ok" as const;
  }, { adminId: auth.user.admin_id });

  if (outcome === "missing") return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;

  const outcome = await withTransaction(async (db) => {
    const c = await findChatbotById(db, Number(chatbotId));
    if (!c || !canAccessChatbot(c, auth.user)) return "missing" as const;
    await deleteChatbot(db, Number(chatbotId));
    return "ok" as const;
  }, { adminId: auth.user.admin_id });

  if (outcome === "missing") return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}