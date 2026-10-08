import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminSession, requireAdminUser } from "@/lib/auth/require";
import { getReindexStatus, reEnqueueIncompleteReembed } from "@/repository/document-jobs";

/** Progress of the most recent re-embed batch (embedding-model change). */
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const status = await withTransaction((db) => getReindexStatus(db, auth.user.admin_id), { adminId: auth.user.admin_id });
  return NextResponse.json(status);
}

/** Re-enqueue re-embed jobs for documents that failed or never completed. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;
  const result = await withTransaction((db) => reEnqueueIncompleteReembed(db, auth.user.admin_id), { adminId: auth.user.admin_id });
  return NextResponse.json({ ok: true, count: result.count });
}