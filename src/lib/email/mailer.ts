import type { MailConfig } from "@/lib/config";

/**
 * SMTP mailer — ports PHP `EmailService` (PHPMailer) to Nodemailer, with an
 * injectable transport so tests need no SMTP server. Env var names stay the same
 * as the PHP `.env` (SMTP_HOST/PORT/AUTH/USER/PASS/ENCRYPTION, MAIL_FROM_*).
 */

export interface Transport {
  sendMail(msg: {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
}

/** Map the PHP SMTP_ENCRYPTION value to Nodemailer secure/startTLS settings. */
export function smtpTransportOptions(cfg: MailConfig): Record<string, unknown> {
  const isSsl = cfg.encryption === "ssl";
  return {
    host: cfg.host,
    port: cfg.port,
    secure: isSsl,
    requireTLS: !isSsl && cfg.encryption === "starttls",
    auth: cfg.auth ? { user: cfg.user, pass: cfg.pass } : undefined,
  };
}

/** Real Nodemailer transport (used by the app; tests inject a fake Transport). */
export async function createMailTransport(cfg: MailConfig): Promise<Transport> {
  const { default: nodemailer } = await import("nodemailer");
  return nodemailer.createTransport(smtpTransportOptions(cfg)) as unknown as Transport;
}

export interface MailContent {
  subject: string;
  html: string;
}

/**
 * Escape a value for interpolation into an email's HTML body. `brand_name` is
 * tenant-controlled (Settings → brand name), so it must not be able to inject
 * markup into the transactional mail sent to that tenant's users.
 */
export function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip CR/LF so a value cannot inject extra headers into a message. */
export function headerSafe(value: string): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * Practical `dot-atom@domain.tld` form. Explicitly excludes the characters that
 * make an address *parse* differently rather than just look odd: parentheses and
 * brackets (RFC 5322 comments/groups — the mis-parsing behind the historical
 * nodemailer recipient-domain bypass), quotes, commas, semicolons, colons and
 * whitespace.
 */
const ADDRESS_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * A recipient must be a bare address: no display name, no comma/semicolon
 * separators, no CRLF and no angle brackets. The registration form takes this
 * value from an unauthenticated request, and address parsing is where the
 * historical nodemailer advisories (recipient-domain bypass via comment parsing)
 * lived, so only the plain shape is forwarded.
 */
export function isSafeRecipient(to: string): boolean {
  const value = (to ?? "").trim();
  return value.length > 0 && value.length <= 254 && !/[\r\n]/.test(to) && ADDRESS_RE.test(value);
}

export async function sendMail(
  transport: Transport,
  to: string,
  content: MailContent,
  cfg: MailConfig,
  onError?: (err: unknown) => void,
): Promise<boolean> {
  if (!isSafeRecipient(to)) {
    (onError ?? console.error)("Mail send refused: recipient is not a plain address");
    return false;
  }
  try {
    await transport.sendMail({
      from: `"${headerSafe(cfg.fromName).replace(/"/g, '\\"')}" <${headerSafe(cfg.fromAddress)}>`,
      to: to.trim(),
      subject: headerSafe(content.subject),
      html: content.html,
      text: content.html.replace(/<[^>]+>/g, ""),
    });
    return true;
  } catch (err) {
    (onError ?? console.error)("Mail send failed:", err);
    return false;
  }
}

// ── Email templates (links built from APP_URL, matching PHP) ────────────────

export function verificationEmail(appUrl: string, token: string, brandName: string): MailContent {
  const link = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const brand = escapeHtml(brandName);
  return {
    subject: `Verify your email — ${headerSafe(brandName)}`,
    html: `<p>Welcome to ${brand}. Please verify your email address:</p><p><a href="${link}">Verify email</a></p>`,
  };
}

export function passwordResetEmail(appUrl: string, token: string, brandName: string): MailContent {
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const brand = escapeHtml(brandName);
  return {
    subject: `Reset your password — ${headerSafe(brandName)}`,
    html: `<p>${brand}: a password reset was requested. This link expires in 60 minutes:</p><p><a href="${link}">Reset password</a></p>`,
  };
}

export function magicLinkEmail(appUrl: string, token: string, brandName: string): MailContent {
  const link = `${appUrl}/magic-login?token=${encodeURIComponent(token)}`;
  const brand = escapeHtml(brandName);
  return {
    subject: `Your sign-in link — ${headerSafe(brandName)}`,
    html: `<p>${brand}: click to sign in (valid for 15 minutes, single use):</p><p><a href="${link}">Sign in</a></p>`,
  };
}