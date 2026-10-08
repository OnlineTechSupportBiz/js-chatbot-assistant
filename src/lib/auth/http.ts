import { NextRequest, NextResponse } from "next/server";
import { SessionManager, PostgresSessionStore } from "./session-manager";
import { sessionCookieAttributes, csrfMatches } from "./session";
import { getConfig } from "@/lib/config";
import { UNKNOWN_IP_BUCKET } from "./rate-limiter";
import { createMailTransport, sendMail, type MailContent } from "@/lib/email/mailer";

/**
 * Request helpers shared by auth route handlers — cookie/CSRF/session plumbing
 * plus body parsing (JSON or form-encoded). The heavy logic lives in the already
 * tested `auth.ts` service.
 */

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;
const UNKNOWN_IP = UNKNOWN_IP_BUCKET;

function isIp(value: string): boolean {
  return IPV4_RE.test(value) || IPV6_RE.test(value);
}

/**
 * Best-effort client address, used for rate-limit keys and audit records.
 *
 * `X-Forwarded-For` is attacker-controlled unless a reverse proxy in front of the
 * app sets it, so it is consulted **only** when the deployment declares how many
 * proxies to trust (`TRUSTED_PROXY_HOPS`, default 0 = trust nothing). With hops
 * configured we take the entry that many places from the right-hand end of the
 * chain — the address the outermost trusted proxy actually observed — so a client
 * that prepends extra entries cannot shift the answer. `X-Real-IP` is
 * non-standard and is ignored unless proxies are trusted too.
 *
 * With no trustworthy address the caller gets one stable deployment-level bucket
 * instead of a spoofable one: per-IP limits then act as a single global bucket,
 * which is why per-account throttling and lockout (see the login path) are the
 * controls that actually hold when the app is exposed directly.
 */
export function clientIp(request: NextRequest): string {
  const hops = getConfig().trustedProxyHops;
  if (hops > 0) {
    const chain = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (chain.length > 0) {
      const index = chain.length - hops;
      const candidate = index >= 0 ? chain[index] : chain[0];
      if (candidate && isIp(candidate)) return candidate;
    }
    const realIp = (request.headers.get("x-real-ip") ?? "").trim();
    if (realIp && isIp(realIp)) return realIp;
  }
  return UNKNOWN_IP;
}

/**
 * Rate-limit bucket for a request, plus whether it is the deployment-wide
 * fallback bucket. Callers scale their allowance when `shared` is true, because a
 * shared bucket is not an identity.
 */
export function clientRateBucket(request: NextRequest): { key: string; shared: boolean } {
  const ip = clientIp(request);
  return { key: ip, shared: ip === UNKNOWN_IP_BUCKET };
}

export function isHttps(request: NextRequest): boolean {
  return request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

/**
 * Whether auth cookies should carry `Secure`.
 *
 * Deriving this from the request alone is unsafe behind a TLS-terminating proxy
 * that does not forward `x-forwarded-proto`: the cookie would then be issued
 * without `Secure` on an otherwise HTTPS deployment. The configured APP_URL
 * scheme is authoritative, with the request as a fallback for deployments that
 * terminate TLS on the app itself.
 */
export function secureCookies(request: NextRequest): boolean {
  return getConfig().url.trim().toLowerCase().startsWith("https://") || isHttps(request);
}

export async function getSession(request: NextRequest): Promise<SessionManager> {
  const cookieName = getConfig().session.cookieName;
  const id = request.cookies.get(cookieName)?.value ?? null;
  return SessionManager.start(new PostgresSessionStore(), id);
}

export function applySessionCookie(response: NextResponse, session: SessionManager, request: NextRequest): void {
  const cfg = getConfig();
  const attrs = sessionCookieAttributes(session.id, {
    remember: session.remember,
    lifetimeMinutes: cfg.session.lifetime,
    secure: secureCookies(request),
  });
  response.cookies.set(attrs.name, attrs.value, {
    httpOnly: attrs.httpOnly,
    sameSite: attrs.sameSite,
    secure: attrs.secure,
    path: attrs.path,
    maxAge: attrs.maxAge,
  });
}

/**
 * Clear the session cookie. Carries the same Secure/HttpOnly/SameSite attributes
 * as the cookie it removes, so an HTTPS deployment cannot have its clearing
 * cookie ignored for attribute mismatch.
 */
export function clearSessionCookie(response: NextResponse, request?: NextRequest): void {
  const cfg = getConfig();
  const secure = request
    ? secureCookies(request)
    : cfg.url.trim().toLowerCase().startsWith("https://");
  response.cookies.set(cfg.session.cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
}

export async function readBody(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return (await request.json()) as Record<string, string>;
    } catch {
      return {};
    }
  }
  const text = await request.text();
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

/** Validate CSRF; returns a 403 JSON response, or null if valid. */
export function csrfCheck(
  token: string | undefined | null,
  session: SessionManager,
): NextResponse | null {
  if (!csrfMatches(session.csrfToken, token)) {
    return NextResponse.json({ error: "Invalid or missing CSRF token." }, { status: 403 });
  }
  return null;
}

export function userAgentOf(request: NextRequest): string | null {
  return request.headers.get("user-agent") ? request.headers.get("user-agent")!.slice(0, 500) : null;
}

/** Deliver an auth email; never throws (sends are best-effort, like PHP EmailService). */
export async function deliverAuthEmail(to: string, content: MailContent): Promise<void> {
  const cfg = getConfig();
  const transport = await createMailTransport(cfg.mail);
  const ok = await sendMail(transport, to, content, cfg.mail);
  if (!ok) {
    console.warn(`[auth] email delivery failed to ${to}`);
  }
}