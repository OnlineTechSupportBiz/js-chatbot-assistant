import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, applySessionCookie } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { disableMfa } from "@/lib/auth/auth";
import { findUserById } from "@/repository/users";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session.isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readBody(request);
  const csrfErr = csrfCheck(body._csrf, session);
  if (csrfErr) return csrfErr;

  const user = await withTransaction((db) => findUserById(db, session.user!.user_id), {
    adminId: session.user!.admin_id,
  });

  const result = await withTransaction(
    (db) => disableMfa(db, session.user!.user_id, body.code ?? "", user?.mfa_secret ?? null, session.id),
    { adminId: session.user!.admin_id },
  );

  const res = NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error },
    { status: result.ok ? 200 : (result as { status: number }).status },
  );
  applySessionCookie(res, session, request);
  return res;
}