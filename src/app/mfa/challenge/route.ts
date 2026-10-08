import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, applySessionCookie, clientIp } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import {
  verifyMfaChallenge,
  mfaRateLimitExceeded,
  recordMfaFailure,
  clearMfaFailures,
} from "@/lib/auth/auth";
import { findUserById, isLocked } from "@/repository/users";

export async function POST(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const body = await readBody(request);
    const csrfErr = csrfCheck(body._csrf, session);
    if (csrfErr) return csrfErr;

    const pending = session.getMfaPending();
    if (!pending) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const ip = clientIp(request);
    const userAgent = request.headers.get("user-agent");

    // Throttled against the account, not the IP: this endpoint previously had no
    // limit at all, so a 6-digit TOTP with a ±1-step window could be brute-forced
    // by anyone who already had the password.
    const outcome = await withTransaction(
      async (db) => {
        if (await mfaRateLimitExceeded(db, pending.user.user_id)) {
          return { status: 429 as const, error: "Too many verification attempts. Please sign in again later." };
        }
        const user = await findUserById(db, pending.user.user_id);
        if (user && (await isLocked(db, user.id))) {
          return {
            status: 429 as const,
            error: "Account temporarily locked due to too many failed attempts.",
          };
        }
        if (!user?.mfa_secret || !verifyMfaChallenge(user.mfa_secret, body.code ?? "")) {
          await recordMfaFailure(
            db,
            { id: pending.user.user_id, admin_id: pending.user.admin_id },
            { ip, userAgent },
          );
          return { status: 400 as const, error: "Invalid verification code." };
        }
        await clearMfaFailures(db, user.id);
        return { status: 200 as const };
      },
      { adminId: pending.user.admin_id },
    );

    if (outcome.status !== 200) {
      const message = "error" in outcome ? outcome.error : "Verification failed.";
      return NextResponse.json({ error: message }, { status: outcome.status });
    }

    session.clearMfaPending();
    await session.login(pending.user, pending.remember, {
      ipAddress: ip,
      userAgent,
    });
    const res = NextResponse.json({ ok: true, redirect: "/dashboard" });
    applySessionCookie(res, session, request);
    return res;
  });
}
