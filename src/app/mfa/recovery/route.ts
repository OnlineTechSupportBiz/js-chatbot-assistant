import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, applySessionCookie, clientIp } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import {
  consumeRecoveryCode,
  mfaRateLimitExceeded,
  recordMfaFailure,
  clearMfaFailures,
} from "@/lib/auth/auth";

export async function POST(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const body = await readBody(request);
    // CSRF: every other auth-mutating route checks the token; this one did not,
    // even though it consumes a recovery code and establishes a session.
    const csrfErr = csrfCheck(body._csrf, session);
    if (csrfErr) return csrfErr;

    const pending = session.getMfaPending();
    if (!pending) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const ip = clientIp(request);
    const userAgent = request.headers.get("user-agent");

    const outcome = await withTransaction(
      async (db) => {
        if (await mfaRateLimitExceeded(db, pending.user.user_id)) {
          return { status: 429 as const, error: "Too many verification attempts. Please sign in again later." };
        }
        const r = await consumeRecoveryCode(db, pending.user.user_id, body.code ?? "");
        if (!r.success) {
          await recordMfaFailure(
            db,
            { id: pending.user.user_id, admin_id: pending.user.admin_id },
            { ip, userAgent },
          );
          return { status: 400 as const, error: "Invalid recovery code." };
        }
        await clearMfaFailures(db, pending.user.user_id);
        return { status: 200 as const, remaining: r.remaining };
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
    const res = NextResponse.json({
      ok: true,
      redirect: "/dashboard",
      remaining_codes: outcome.remaining,
    });
    applySessionCookie(res, session, request);
    return res;
  });
}
