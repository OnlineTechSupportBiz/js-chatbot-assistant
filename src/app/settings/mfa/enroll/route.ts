import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, applySessionCookie } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { completeMfaEnrollment } from "@/lib/auth/auth";

/** Complete MFA enrollment by verifying the TOTP code against the stashed enrollment. */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session.isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readBody(request);
  const csrfErr = csrfCheck(body._csrf, session);
  if (csrfErr) return csrfErr;

  const enroll = session.getMfaEnroll();
  if (!enroll) {
    return NextResponse.json({ error: "Start enrollment first." }, { status: 400 });
  }

  const result = await withTransaction(
    (db) =>
      completeMfaEnrollment(
        db,
        session.user!.user_id,
        enroll.secret,
        enroll.recoveryCodes,
        body.code ?? "",
        session.id,
      ),
    { adminId: session.user!.admin_id },
  );

  if (result.ok) {
    session.clearMfaEnroll();
    await session.save();
  }

  const res = NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error },
    { status: result.ok ? 200 : (result as { status: number }).status },
  );
  applySessionCookie(res, session, request);
  return res;
}