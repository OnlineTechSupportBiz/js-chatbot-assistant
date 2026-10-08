import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth/require";
import { listAuditLogs } from "@/repository/audit-logs";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(200, Math.max(1, parseInt(sp.get("per_page") ?? "50", 10) || 50));
  const action = sp.get("action") ?? undefined;

  const result = await withTransaction(
    (db) => listAuditLogs(db, { adminId: auth.user.admin_id, page, perPage, action }),
    { adminId: auth.user.admin_id },
  );
  return NextResponse.json(result);
}