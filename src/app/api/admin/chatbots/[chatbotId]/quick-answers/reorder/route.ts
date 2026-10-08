import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById } from "@/repository/chatbots";
import { reorderQuickAnswers } from "@/lib/admin/quick-answers";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;
  const id = Number(chatbotId);

  let ids: number[];
  try {
    const parsed = JSON.parse(auth.body.ids);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    ids = parsed.map((v) => parseInt(String(v), 10)).filter((n) => !Number.isNaN(n));
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const outcome = await withTransaction(async (db) => {
    const chatbot = await findChatbotById(db, id);
    if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return "missing" as const;
    await reorderQuickAnswers(db, auth.user, id, ids);
    return "ok" as const;
  }, { adminId: auth.user.admin_id });

  if (outcome === "missing") return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}