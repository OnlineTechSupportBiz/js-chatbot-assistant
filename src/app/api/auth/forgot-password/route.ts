import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, deliverAuthEmail, clientRateBucket } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import { requestPasswordReset, FORGOT_RATE_MAX, AUTH_EMAIL_RATE_WINDOW } from "@/lib/auth/auth";
import { rateLimitCheck, rateLimitRecord } from "@/lib/auth/rate-limiter";
import { passwordResetEmail } from "@/lib/email/mailer";
import { getConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const body = await readBody(request);
    const csrfErr = csrfCheck(body._csrf, session);
    if (csrfErr) return csrfErr;

    const email = (body.email ?? "").trim().toLowerCase();

    // Unauthenticated endpoint that sends mail: throttle the bucket it came from.
    // A shared bucket (no trustworthy client address) gets a larger allowance so
    // one caller cannot exhaust it for everybody.
    const bucket = clientRateBucket(request);
    const limit = bucket.shared ? FORGOT_RATE_MAX * 10 : FORGOT_RATE_MAX;
    const allowed = await withTransaction((db) =>
      rateLimitCheck(db, bucket.key, limit, AUTH_EMAIL_RATE_WINDOW, "forgot:"),
    );
    if (!allowed) {
      // Identical to the success response: the endpoint stays enumeration-neutral.
      return NextResponse.json({ ok: true });
    }
    await withTransaction((db) => rateLimitRecord(db, bucket.key, "forgot:"));

    const result = await withTransaction((db) => requestPasswordReset(db, email));

    // Best-effort email (anti-enumeration: identical response either way).
    if (result.token) {
      await deliverAuthEmail(result.email, passwordResetEmail(getConfig().url, result.token, result.brandName));
    }

    return NextResponse.json({ ok: true });
  });
}
