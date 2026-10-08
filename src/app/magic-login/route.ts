import { NextRequest, NextResponse } from "next/server";
import { getSession, applySessionCookie, clientIp, userAgentOf } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { verifyMagicLink } from "@/lib/auth/auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const session = await getSession(request);

  const result = await withTransaction((db) => verifyMagicLink(db, token));

  if (!result.ok) {
    return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent(result.error), request.url));
  }

  if (result.needsMfa) {
    session.setMfaPending(result.user, false);
    await session.save();
    const res = NextResponse.redirect(new URL("/mfa/challenge", request.url));
    applySessionCookie(res, session, request);
    return res;
  }

  await session.login(result.user, false, {
    ipAddress: clientIp(request),
    userAgent: userAgentOf(request),
  });
  const res = NextResponse.redirect(new URL("/dashboard", request.url));
  applySessionCookie(res, session, request);
  return res;
}