import { NextRequest, NextResponse } from "next/server";
import { getSession, applySessionCookie } from "@/lib/auth/http";
import { dbGuarded } from "@/lib/db-error-response";

/** Establishes a guest session and returns its CSRF token for the login/register forms. */
export async function GET(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const res = NextResponse.json({ csrf: session.csrfToken });
    applySessionCookie(res, session, request);
    return res;
  });
}
