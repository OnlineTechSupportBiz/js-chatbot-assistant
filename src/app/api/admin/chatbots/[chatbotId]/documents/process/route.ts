import { NextRequest, NextResponse } from "next/server";
import { withTransaction, withSessionAdminId } from "@/lib/db";
import { requireAdminUser } from "@/lib/auth/require";
import { findChatbotById } from "@/repository/chatbots";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { claimNextTrainJobForChatbot } from "@/repository/document-jobs";
import { processDocumentJob } from "@/lib/pipeline/process-job";
import { LlamaParseClient } from "@/lib/llamaparse/client";
import { OpenAIClient, type OpenAIClientConfig } from "@/lib/openai/client";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

/**
 * Drain this chatbot's pending train jobs inline (a "process now" fallback for
 * when the background worker is not running). Processes up to 50 jobs per request.
 */
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;
  const id = Number(chatbotId);
  const adminId = auth.user.admin_id;

  const chatbot = await withTransaction((db) => findChatbotById(db, id), { adminId });
  if (!chatbot || !canAccessChatbot(chatbot, auth.user)) {
    return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  }

  const deps = {
    makeLlama: (key: string) => new LlamaParseClient(key),
    makeEmbedder: (config: OpenAIClientConfig) => new OpenAIClient(config),
  };

  let completed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let n = 0; n < 50; n++) {
    const job = await withTransaction((db) => claimNextTrainJobForChatbot(db, adminId, id));
    if (!job) break;

    const result = await withSessionAdminId(adminId, (db) =>
      processDocumentJob(deps, db, { id: job.id, document_id: job.document_id }),
    );
    if (result === "completed") completed++;
    else {
      failed++;
      // Surface a short error for the UI.
      const row = await withTransaction((db) => db.query("SELECT error_message FROM document_jobs WHERE id = $1", [job.id]));
      const msg = row.rows[0]?.error_message ?? "Unknown error";
      errors.push(msg);
    }
  }

  return NextResponse.json({ ok: true, completed, failed, errors });
}