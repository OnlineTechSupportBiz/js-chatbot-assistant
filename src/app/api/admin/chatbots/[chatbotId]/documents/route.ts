import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { getSession, csrfCheck } from "@/lib/auth/http";
import { requireAdminSession, requireAdminUser } from "@/lib/auth/require";
import { canAccessChatbot } from "@/lib/chatbot/access";
import { findChatbotById } from "@/repository/chatbots";
import { findByChatbot } from "@/repository/documents";
import { uploadDocument, deleteAllDocumentsForChatbot, UploadError, MAX_FILE_SIZE } from "@/lib/admin/documents";
import { LocalDiskStorage } from "@/lib/storage/storage";
import { readCappedBody, parseMultipartFormData } from "@/lib/http/capped-body";

type RouteCtx = { params: Promise<{ chatbotId: string }> };

/**
 * Ceiling on the raw request body: one file plus multipart overhead. Checked
 * against Content-Length as a cheap early reject, and then enforced for real by
 * `readCappedBody` while the body is read.
 */
const MAX_UPLOAD_BODY_BYTES = MAX_FILE_SIZE + 1024 * 1024;

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;

  const documents = await withTransaction(async (db) => {
    const chatbot = await findChatbotById(db, Number(chatbotId));
    if (!chatbot || !canAccessChatbot(chatbot, auth.user)) return null;
    return findByChatbot(db, auth.user.admin_id, Number(chatbotId));
  }, { adminId: auth.user.admin_id });

  if (documents === null) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  return NextResponse.json(documents);
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const session = await getSession(req);
  if (!session.isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { chatbotId } = await params;

  // Reject a declared-oversized body before it is read, then read it OURSELVES
  // under the same cap. `req.formData()` materialises the whole multipart payload
  // in memory, so the per-file cap applied later (inside uploadDocument) is far
  // too late to protect the process — and a Content-Length check alone only stops
  // clients that declare their size honestly. A chunked or lying request would
  // still be buffered in full; `readCappedBody` stops reading the moment the cap
  // is exceeded, so the allocation is bounded regardless (SEC-11).
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }

  const bodyBytes = await readCappedBody(req.body, MAX_UPLOAD_BODY_BYTES);
  if (bodyBytes === null) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await parseMultipartFormData(bodyBytes, req.headers.get("content-type"));
  } catch {
    return NextResponse.json({ error: "Malformed upload request." }, { status: 400 });
  }

  const csrf = form.get("_csrf");
  const csrfErr = csrfCheck(typeof csrf === "string" ? csrf : null, session);
  if (csrfErr) return csrfErr;

  const file = form.get("document");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Please select a file to upload." }, { status: 400 });
  }
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const documentId = await withTransaction(async (db) => {
      const chatbot = await findChatbotById(db, Number(chatbotId));
      if (!chatbot || !canAccessChatbot(chatbot, session.user!)) return null;
      return uploadDocument(db, new LocalDiskStorage(), session.user!, Number(chatbotId), chatbot.retrieval_strategy, {
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        data,
      });
    }, { adminId: session.user!.admin_id });

    if (documentId === null) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id: documentId, name: file.name, size: file.size, mime: file.type });
  } catch (err) {
    if (err instanceof UploadError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** Delete the whole document store (every file + index) for this chatbot. */
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { chatbotId } = await params;
  const id = Number(chatbotId);

  const chatbot = await withTransaction((db) => findChatbotById(db, id), { adminId: auth.user.admin_id });
  if (!chatbot || !canAccessChatbot(chatbot, auth.user)) {
    return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });
  }

  const count = await withTransaction(
    (db) => deleteAllDocumentsForChatbot(db, new LocalDiskStorage(), auth.user, id),
    { adminId: auth.user.admin_id },
  );
  return NextResponse.json({ ok: true, count });
}