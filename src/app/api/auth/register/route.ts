import { NextRequest, NextResponse } from "next/server";
import { getSession, clientIp, readBody, userAgentOf, csrfCheck, deliverAuthEmail, clientRateBucket } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import { register, requestPasswordReset, REGISTER_RATE_MAX, AUTH_EMAIL_RATE_WINDOW } from "@/lib/auth/auth";
import { rateLimitCheck, rateLimitRecord } from "@/lib/auth/rate-limiter";
import { verificationEmail, passwordResetEmail } from "@/lib/email/mailer";
import { getConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const body = await readBody(request);
    const csrfErr = csrfCheck(body._csrf, session);
    if (csrfErr) return csrfErr;

    // The registration gate is config-driven (ALLOW_REGISTRATION), not a DB
    // setting. Checked here as well as on the page: PHP only gated GET /register,
    // so a direct POST could still create an account with registration "off".
    if (!getConfig().allowRegistration) {
      return NextResponse.json({ error: "New user registration is currently disabled." }, { status: 403 });
    }

    // Unauthenticated account creation: throttle the bucket it came from. A shared
    // bucket (no trustworthy client address) gets a larger allowance so one caller
    // cannot exhaust it and block signups for everybody.
    const bucket = clientRateBucket(request);
    const limit = bucket.shared ? REGISTER_RATE_MAX * 10 : REGISTER_RATE_MAX;
    const allowed = await withTransaction((db) =>
      rateLimitCheck(db, bucket.key, limit, AUTH_EMAIL_RATE_WINDOW, "register:"),
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many sign-up attempts. Please try again later." },
        { status: 429 },
      );
    }
    await withTransaction((db) => rateLimitRecord(db, bucket.key, "register:"));

    const result = await withTransaction((db) =>
      register(db, {
        name: body.name ?? "",
        email: body.email ?? "",
        password: body.password ?? "",
        company: body.company ?? null,
        ip: clientIp(request),
        userAgent: userAgentOf(request),
      }),
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Both outcomes answer identically (the service reports an already-registered
    // address as `exists` rather than an error), so signup cannot be used to
    // enumerate accounts — but each outcome does something different by email.
    if (result.kind === "created") {
      const content = verificationEmail(getConfig().url, result.verifyToken, result.user.brand_name);
      await deliverAuthEmail(result.user.user_email, content);
    } else {
      // The address already has an account: a reset link is the useful action.
      const reset = await withTransaction((db) => requestPasswordReset(db, result.email));
      if (reset.token) {
        await deliverAuthEmail(reset.email, passwordResetEmail(getConfig().url, reset.token, reset.brandName));
      }
    }

    // No session is issued before the address is confirmed: `login` refuses an
    // unverified account, so signing in here would sidestep that gate — and the
    // admin area now refuses an unverified session too.
    return NextResponse.json({
      ok: true,
      verify: true,
      message: "Check your inbox to confirm your email address, then sign in.",
    });
  });
}
