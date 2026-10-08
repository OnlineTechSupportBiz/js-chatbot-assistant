import { NextRequest, NextResponse } from "next/server";
import { getSession, clientIp, readBody, applySessionCookie, userAgentOf, csrfCheck } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import { login } from "@/lib/auth/auth";

export async function POST(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const body = await readBody(request);
    const csrfErr = csrfCheck(body._csrf, session);
    if (csrfErr) return csrfErr;

    const result = await withTransaction((db) =>
      login(db, {
        email: body.email ?? "",
        password: body.password ?? "",
        remember: !!body.remember,
        ip: clientIp(request),
        userAgent: userAgentOf(request),
      }),
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.needsMfa) {
      session.setMfaPending(result.user, !!body.remember);
      await session.save();
      const res = NextResponse.json({ ok: true, mfa: true, redirect: "/mfa/challenge" });
      applySessionCookie(res, session, request);
      return res;
    }

    await session.login(result.user, !!body.remember, {
      ipAddress: clientIp(request),
      userAgent: userAgentOf(request),
    });
    const res = NextResponse.json({ ok: true, redirect: "/dashboard" });
    applySessionCookie(res, session, request);
    return res;
  });
}
