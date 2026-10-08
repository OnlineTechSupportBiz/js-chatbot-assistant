import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth/require";
import { listByAdmin } from "@/repository/conversations";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const conversations = await withTransaction((db) => listByAdmin(db, auth.user.admin_id), { adminId: auth.user.admin_id });
  return NextResponse.json(conversations);
}