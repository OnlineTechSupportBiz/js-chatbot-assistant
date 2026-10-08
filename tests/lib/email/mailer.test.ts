import { describe, it, expect } from "vitest";
import { smtpTransportOptions, sendMail, verificationEmail, passwordResetEmail, magicLinkEmail, isSafeRecipient } from "@/lib/email/mailer";
import type { MailConfig } from "@/lib/config";
import type { Transport } from "@/lib/email/mailer";

const cfg: MailConfig = {
  host: "smtp.example.com",
  port: 587,
  auth: true,
  user: "u",
  pass: "p",
  encryption: "starttls",
  fromAddress: "noreply@example.com",
  fromName: "Chatbot Assistant",
};

describe("smtpTransportOptions", () => {
  it("maps starttls → secure false + requireTLS", () => {
    const o = smtpTransportOptions(cfg);
    expect(o.secure).toBe(false);
    expect(o.requireTLS).toBe(true);
    expect(o.auth).toEqual({ user: "u", pass: "p" });
  });

  it("maps ssl → secure true", () => {
    const o = smtpTransportOptions({ ...cfg, encryption: "ssl" });
    expect(o.secure).toBe(true);
    expect(o.requireTLS).toBe(false);
  });

  it("omits auth when disabled", () => {
    const o = smtpTransportOptions({ ...cfg, auth: false });
    expect(o.auth).toBeUndefined();
  });
});

describe("sendMail", () => {
  it("returns true on success and passes a balanced From header", async () => {
    let sent: unknown;
    const transport: Transport = {
      async sendMail(msg) {
        sent = msg;
        return {};
      },
    };
    const ok = await sendMail(transport, "to@x.com", verificationEmail("https://app", "tok", "Acme"), cfg);
    expect(ok).toBe(true);
    expect((sent as { from: string }).from).toBe('"Chatbot Assistant" <noreply@example.com>');
  });

  it("returns false on transport error (no throw)", async () => {
    const transport: Transport = {
      async sendMail() {
        throw new Error("smtp down");
      },
    };
    const errors: unknown[] = [];
    const ok = await sendMail(transport, "to@x.com", verificationEmail("https://app", "tok", "Acme"), cfg, (e) => errors.push(e));
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
  });
});

describe("email templates", () => {
  it("builds links from APP_URL + token and includes brand name", () => {
    expect(verificationEmail("https://app", "abc", "Acme").html).toContain("https://app/verify-email?token=abc");
    expect(passwordResetEmail("https://app", "abc", "Acme").subject).toContain("Acme");
    expect(magicLinkEmail("https://app", "abc", "Acme").html).toContain("magic-login?token=abc");
  });

  it("escapes a brand name instead of injecting markup into the body", () => {
    const evil = '<a href="https://evil.example">Click here to verify</a>';
    const mail = passwordResetEmail("https://app", "abc", evil);
    expect(mail.html).not.toContain("<a href=\"https://evil.example\"");
    expect(mail.html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });

  it("flattens a brand name containing CRLF so it cannot inject headers", () => {
    const mail = verificationEmail("https://app", "abc", "Acme\r\nBcc: attacker@example.com");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

describe("recipient validation", () => {
  it("accepts a plain address", () => {
    expect(isSafeRecipient("user@example.com")).toBe(true);
    expect(isSafeRecipient("  user@example.com  ")).toBe(true);
  });

  it("refuses display names, separators, CRLF and comment forms", () => {
    const refused = [
      "User <user@example.com>",
      "a@example.com, b@example.com",
      "a@example.com;b@example.com",
      "user@example.com\r\nBcc: attacker@example.com",
      "user(comment)@example.com",
      "no-at-sign",
      "",
    ];
    for (const value of refused) {
      expect(isSafeRecipient(value)).toBe(false);
    }
  });

  it("does not hand an unsafe recipient to the transport", async () => {
    let called = false;
    const transport: Transport = {
      async sendMail() {
        called = true;
        return {};
      },
    };
    const errors: unknown[] = [];
    const ok = await sendMail(
      transport,
      "victim@example.com\r\nBcc: attacker@example.com",
      verificationEmail("https://app", "tok", "Acme"),
      cfg,
      (e) => errors.push(e),
    );
    expect(ok).toBe(false);
    expect(called).toBe(false);
    expect(errors).toHaveLength(1);
  });
});