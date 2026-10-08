import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth/require";
import { findByAdmin } from "@/repository/leads";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const leads = await withTransaction((db) => findByAdmin(db, auth.user.admin_id), { adminId: auth.user.admin_id });
  return NextResponse.json(leads);
}