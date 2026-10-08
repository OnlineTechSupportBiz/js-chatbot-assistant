import type { DbClient } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import type { Storage } from "@/lib/storage/storage";
import { createDocument, findStrategyByOriginalName, findByOriginalName, findDocumentById, findByChatbot, deleteDocument, deleteAllByChatbot, type NewDocument } from "@/repository/documents";
import { enqueueDocumentJob } from "@/repository/document-jobs";
import { logAudit } from "@/repository/audit-logs";

/**
 * Document admin service — port of PHP `DocumentController` store/delete + the
 * background-job trigger (the PHP runs training inline; the port enqueues it).
 */

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

const MIME_MAP: Record<string, string> = {
  "application/x-pdf": "application/pdf",
  "application/pdf": "application/pdf",
  "text/plain": "text/plain",
  "text/markdown": "text/markdown",
  "application/msword": "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** What the first bytes of a file actually look like. */
type SniffedKind = "pdf" | "zip" | "ole2" | "text" | "binary";

/**
 * Allowed extensions and required content signature per declared type. A
 * Content-Type is whatever the client says it is, so the declared type is only
 * accepted when the name and the leading bytes agree with it.
 */
const TYPE_RULES: Array<{ mime: string; extensions: string[]; kind: SniffedKind }> = [
  { mime: "application/pdf", extensions: [".pdf"], kind: "pdf" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx"],
    kind: "zip",
  },
  { mime: "application/msword", extensions: [".doc"], kind: "ole2" },
  { mime: "text/plain", extensions: [".txt"], kind: "text" },
  { mime: "text/markdown", extensions: [".md", ".markdown"], kind: "text" },
];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

/** Classify a file by its magic bytes (NUL-free prefix ⇒ text). */
export function sniffKind(data: Uint8Array): SniffedKind {
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return "zip"; // PK\x03\x04 (docx/zip container)
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole2"; // legacy .doc
  const head = data.subarray(0, Math.min(data.length, 8192));
  for (const byte of head) {
    if (byte === 0) return "binary";
  }
  return "text";
}

/**
 * Validate a declared type, its extension and the file's actual leading bytes.
 * Returns the normalised MIME type and the sanitised base name.
 */
export function validateUpload(upload: UploadInput): { mimeType: string; originalName: string } {
  const declared = upload.mimeType.toLowerCase();
  const normalizedMime = MIME_MAP[declared];
  if (!normalizedMime) {
    throw new UploadError(`Unsupported file type: ${upload.mimeType}. Allowed: PDF, DOC, DOCX, TXT, MD.`);
  }

  const originalName = basename(upload.originalName);
  const dot = originalName.lastIndexOf(".");
  const extension = dot >= 0 ? originalName.slice(dot).toLowerCase() : "";

  const rule = TYPE_RULES.find((r) => r.mime === normalizedMime);
  if (rule && rule.extensions.length > 0 && !rule.extensions.includes(extension)) {
    throw new UploadError(
      `File extension "${extension || "(none)"}" does not match its declared type ${normalizedMime}.`,
    );
  }

  const kind = sniffKind(upload.data);
  if (rule && kind !== rule.kind) {
    // e.g. an executable labelled application/pdf, or a PDF labelled text/plain.
    throw new UploadError("File content does not match its declared type.");
  }

  return { mimeType: normalizedMime, originalName };
}

export class UploadError extends Error {}

export interface UploadInput {
  originalName: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
}

export async function uploadDocument(
  db: DbClient,
  storage: Storage,
  user: SessionUser,
  chatbotId: number,
  currentStrategy: string,
  upload: UploadInput,
): Promise<number> {
  // ── Type / size validation ──
  const { mimeType: normalizedMime, originalName } = validateUpload(upload);
  if (upload.size > MAX_FILE_SIZE) {
    throw new UploadError("File exceeds 20 MB maximum size.");
  }

  // ── Duplicate check (same name under the same strategy, or untrained) ──
  const existingStrategy = await findStrategyByOriginalName(db, chatbotId, originalName);
  if (existingStrategy !== null && existingStrategy.strategy === currentStrategy) {
    throw new UploadError(`A file named "${originalName}" has already been uploaded for ${currentStrategy}.`);
  }
  const existingDoc = await findByOriginalName(db, user.admin_id, chatbotId, originalName);
  if (existingDoc !== null && existingStrategy === null) {
    throw new UploadError(`A file named "${originalName}" has already been uploaded (not yet trained).`);
  }

  // ── Store the file ──
  const storedName = `${user.admin_id}_${chatbotId}_${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const destPath = await storage.save(upload.data, storedName);

  // ── Create the document record ──
  // The write above is outside the database's control, so if anything below fails
  // the surrounding transaction rolls the rows back but the bytes stay on disk
  // unless they are removed here.
  try {
    const input: NewDocument = {
      adminId: user.admin_id,
      chatbotId,
      filename: storedName,
      originalName,
      mimeType: normalizedMime,
      filePath: destPath,
      fileSize: upload.size,
      status: "uploaded",
      uploadedBy: user.user_id,
    };
    const documentId = await createDocument(db, input);

    await logAudit(db, {
      adminId: user.admin_id, userId: user.user_id,
      action: "create_document", entityType: "document", entityId: documentId,
      newValue: { name: originalName, chatbot_id: chatbotId, size: upload.size },
    });

    // ── Enqueue training (background job) ──
    await enqueueDocumentJob(db, documentId);

    return documentId;
  } catch (err) {
    await storage.remove(destPath);
    throw err;
  }
}

export async function deleteDocumentWithFile(db: DbClient, storage: Storage, user: SessionUser, documentId: number): Promise<void> {
  const document = await findDocumentById(db, documentId);
  const originalName = document?.original_name ?? null;
  await storage.remove(document?.file_path ?? null);
  await deleteDocument(db, documentId);
  await logAudit(db, {
    adminId: user.admin_id, userId: user.user_id,
    action: "delete_document", entityType: "document", entityId: documentId,
    newValue: { name: originalName },
  });
}

/** Delete every stored file + document record (and its index) for a chatbot. */
export async function deleteAllDocumentsForChatbot(db: DbClient, storage: Storage, user: SessionUser, chatbotId: number): Promise<number> {
  const docs = await findByChatbot(db, user.admin_id, chatbotId);
  for (const doc of docs) {
    await storage.remove(doc.file_path ?? null);
  }
  await deleteAllByChatbot(db, user.admin_id, chatbotId);
  await logAudit(db, {
    adminId: user.admin_id, userId: user.user_id,
    action: "delete_all_documents", entityType: "chatbot", entityId: chatbotId,
    newValue: { count: docs.length },
  });
  return docs.length;
}

function basename(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? name;
}