import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser } from "@/lib/auth/require";
import { findChatbotById } from "@/repository/chatbots";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { enqueueReprocessForChatbot } from "@/repository/document-jobs";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

/**
 * Re-process every document of a chatbot against its current retrieval strategy
 * and embedding config. Enqueues background train jobs (the documents' stored
 * parsed text / files are reused, so no re-upload is needed).
 */
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;
  const id = Number(chatbotId);

  const chatbot = await withTransaction((db) => findChatbotById(db, id), { adminId: auth.user.admin_id });
  if (!chatbot || !canAccessChatbot(chatbot, auth.user)) {
    return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  }

  const count = await withTransaction((db) => enqueueReprocessForChatbot(db, auth.user.admin_id, id), { adminId: auth.user.admin_id });
  return NextResponse.json({ ok: true, count });
}