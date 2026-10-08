import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser, requireAdminSession } from "@/lib/auth/require";
import { findByAdmin } from "@/repository/chatbots";
import { storeChatbot, type ChatbotFormInput } from "@/lib/chatbot/chatbot";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const chatbots = await withTransaction((db) => findByAdmin(db, auth.user.admin_id), { adminId: auth.user.admin_id });
  return NextResponse.json(chatbots);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

  const input: ChatbotFormInput = { name: auth.body.name ?? "", ...auth.body };
  const id = await withTransaction((db) => storeChatbot(db, auth.user, input), { adminId: auth.user.admin_id });
  return NextResponse.json({ ok: true, id });
}