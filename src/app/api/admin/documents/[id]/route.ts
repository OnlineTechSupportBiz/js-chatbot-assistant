import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser, requireAdminSession } from "@/lib/auth/require";
import { findDocumentById } from "@/repository/documents";
import { countByDocument } from "@/repository/document-chunks";
import { countByDocument as countPageNodes } from "@/repository/document-page-index";
import { deleteDocumentWithFile } from "@/lib/admin/documents";
import { LocalDiskStorage } from "@/lib/storage/storage";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const result = await withTransaction(async (db) => {
    const doc = await findDocumentById(db, Number(id));
    if (!doc || doc.admin_id !== auth.user.admin_id) return null;
    const chunkCount = await countByDocument(db, Number(id));
    const pageNodes = await countPageNodes(db, Number(id));
    return { ...doc, chunk_count: chunkCount, page_node_count: pageNodes };
  }, { adminId: auth.user.admin_id });

  if (result === null) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const outcome = await withTransaction(async (db) => {
    const doc = await findDocumentById(db, Number(id));
    if (!doc || doc.admin_id !== auth.user.admin_id) return "missing" as const;
    await deleteDocumentWithFile(db, new LocalDiskStorage(), auth.user, Number(id));
    return "ok" as const;
  }, { adminId: auth.user.admin_id });

  if (outcome === "missing") return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}