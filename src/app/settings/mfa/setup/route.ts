import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, applySessionCookie } from "@/lib/auth/http";
import { startMfaEnrollment } from "@/lib/auth/auth";

/**
 * Start MFA enrollment: mint a secret + recovery codes and stash them in the
 * session.
 *
 * POST, not GET: it mutates session state and mints a credential, so it sits
 * behind the same CSRF check as the other MFA routes (a GET could be triggered
 * cross-site by any image tag).
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session.isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readBody(request);
  const csrfErr = csrfCheck(body._csrf, session);
  if (csrfErr) return csrfErr;

  const { secret, recoveryCodes } = startMfaEnrollment();
  session.setMfaEnroll(secret, recoveryCodes);
  await session.save();

  const res = NextResponse.json({ ok: true, secret, recovery_codes: recoveryCodes });
  applySessionCookie(res, session, request);
  return res;
}