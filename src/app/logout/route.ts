import { NextRequest, NextResponse } from "next/server";
import { getSession, clearSessionCookie, csrfCheck, readBody } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { logAudit } from "@/repository/audit-logs";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  const body = await readBody(request);
  const csrfErr = csrfCheck(body._csrf, session);
  if (csrfErr) return csrfErr;

  const user = session.user;
  if (user) {
    await withTransaction((db) =>
      logAudit(db, {
        adminId: user.admin_id,
        userId: user.user_id,
        action: "logout",
        entityType: "user",
        entityId: user.user_id,
        ipAddress: request.headers.get("x-forwarded-for"),
      }),
    );
  }

  await session.logout();
  const res = NextResponse.redirect(new URL("/login", request.url));
  clearSessionCookie(res, request);
  return res;
}